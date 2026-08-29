# The bridge

Everything that crosses between the web layer and Kotlin, and everything that
exists on both sides of that line.

The app is one HTML page in a WebView plus six Kotlin files. The page owns the
book and the interface; Kotlin owns the filesystem, the microphone, the alarms
and the home screen. They meet in exactly two places: `window.Android`, and
`window.onNative`.

**`Bridge` may be `null` for every one of them.** Opening `index.html` in a
desktop browser is a supported mode — the app is fully explorable there, with
state in memory — so every call below is guarded, and a feature that needs the
shell says so rather than breaking. `js/store.js` does the detection:

```js
const Bridge = window.Android && typeof window.Android.save === 'function' ? window.Android : null;
```

---

## Out — JavaScript calls Kotlin

Twenty-two `@JavascriptInterface` methods on `SpellbookBridge`. Every one runs
on a binder thread, not the main thread; anything needing the main thread hops
there itself.

### The book

| Method | Answers | Notes |
|---|---|---|
| `bookState()` | `"missing"` · `"ok"` · `"unreadable"` | Ask this **before** `load()`. It is the difference between a first run and a book you must not overwrite. |
| `load()` | the file's text, or `""` | `""` means "nothing there" only when `bookState()` said `missing`; after an `ok` it means an I/O failure. |
| `save(json)` | — | Temp file, rename, daily snapshot, widget refresh, alarm sync. The offsite copy runs on its own thread so this returns as soon as the book is on disk. |
| `export(name, data)` | where it landed, as a label | Public Downloads via MediaStore, falling back to the app folder. |

### Earlier versions

| Method | Answers |
|---|---|
| `snapshots()` | `[{"name","at","bytes","spells"}]`, newest first. `spells` is `-1` when the file wouldn't parse. |
| `readSnapshot(name)` | that snapshot's text, or `""` if the name isn't one of ours |
| `preRestoreBackup(json)` | the name written, or `""` |

Names are validated against `^spellbook-\d{4}-\d{2}-\d{2}\.json$` and
`^pre-restore-\d{8}-\d{6}\.json$` before the filesystem is touched — the same
discipline as `VoiceRecorder.safeName`, for the same reason: **the web layer
must never be able to name a path.**

### Voice notes

| Method | Answers | Notes |
|---|---|---|
| `startVoiceNote(preferBluetooth)` | — | Fire and forget; everything that happens next arrives through `onNative`. |
| `stopVoiceNote()` | — | |
| `cancelVoiceNote()` | — | |
| `bluetoothMicAvailable()` | `boolean` | For the Vault's copy — is there a headset *right now*. |
| `mediaList()` | `["vn_….m4a", …]` | What is actually on disk, so a note whose audio is gone can say so. |
| `deleteMedia(name)` | `boolean` | |
| `pruneMedia(referencedJson)` | how many were deleted | Boot housekeeping. Skipped while recording. |

### Reminders

| Method | Answers |
|---|---|
| `notifyState()` | `{"canPost":bool,"max":int,"defaultText":string}` |
| `requestNotifyPermission()` | — |
| `openNotificationSettings()` | — |
| `openRequest()` | `""` · `"draw"` · `"spell:<id>"`, read once at boot |

### The backup folder

| Method | Answers |
|---|---|
| `backupInfo()` | `{"set":bool,"label":string,"lastAt":millis}` |
| `pickBackupFolder()` | — (opens the system picker) |
| `clearBackupFolder()` | — |
| `backupNow(json)` | `{"ok":bool,"message":string}` — synchronous on purpose: the page waits and reports |

---

## In — Kotlin calls JavaScript

One channel: `window.onNative(jsonString)`, handled in `js/voice.js`. Kotlin
sends it through `MainActivity.emit()`. Every payload has a `kind`.

| kind | payload | sent when |
|---|---|---|
| `backup` | `{type:'folder', message?}` | the folder picker returned |
| `open` | `{target}` — `'draw'` or `'spell:<id>'` | a reminder or widget was tapped while the app was already running |
| `notify` | `{granted, quiet?}` | the permission prompt answered, or `quiet:true` on resume from system settings |
| `voice` | `{type, …}` | throughout a recording |

`voice` types, in the order a good recording sees them:

| type | extra | meaning |
|---|---|---|
| `routing` | | asking the audio stack for a device |
| `fellBack` | | no headset in time; using the built-in mic |
| `started` | `bluetooth` | capture is running |
| `level` | `level`, `ms` | a few times a second, for the meter |
| `route` | `via` | the microphone actually in use *changed* |
| `saved` | `file`, `duration`, `bluetooth` | the note's audio is on disk |
| `tooShort` | | under 800ms; thrown away |
| `cancelled` | | |
| `denied` | | no microphone permission |
| `error` | `message` | |

---

## The duplication register

Eight things exist on both sides of the boundary with nothing keeping them in
step. This is not a bug list — it is what the next change to either side has to
know it must mirror.

| # | Duplicated | JavaScript | Kotlin | Collapsible? |
|---|---|---|---|---|
| 1 | `**bold**` / `*italic*` / `==highlight==` | `fmt()` — `js/util.js` | `SpellWidget.MARKUP` + `styled()` | No — different render targets |
| 2 | Weighted pick | `weightOf` / `weightedIndex` — `index.html` | `Book.weighted` | No — Kotlin's must stay deterministic |
| 3 | Tag names `inbox` / `flagged` | `INBOX` / `FLAGGED` — `index.html` | `Book.INBOX` / `FLAGGED` | No |
| 4 | Default draw weights (3 / 1) | `DEFAULTS` — `index.html` | `Book.spellOfTheDay` fallbacks | Partly |
| 5 | Reminder cap of 3 | ~~`NOTIFY_MAX`~~ → `notifyLimits().max` | `Reminders.MAX` | **Collapsed** |
| 6 | Default reminder text | ~~`DEFAULTS.notifyText`~~ → `notifyLimits().defaultText` | `Reminders.DEFAULT_TEXT` | **Collapsed** |
| 7 | Colour palette | `:root` — `css/app.css` | `res/values/colors.xml` | No |
| 8 | Media filename shape | trusted implicitly | `VoiceRecorder.SAFE` | No — Kotlin's is the security boundary |

**#5 and #6 are done.** `notifyState()` had been sending both values across all
along and the page ignored them in favour of its own constants — which is
exactly how two constants drift apart. `js/reminders.js` now reads what it is
told, once, with fallbacks that only apply in preview where there is no bridge
to ask. Kotlin holds the single definition.

**Three of the rest — `fmt`, `cleanTimes`, `weightOf` — have tests on the JS
side** (`tools/smoke.mjs`). The Kotlin twins don't. Changing one half without
the other is the likeliest way to break this app.

**Not on the register, and worth knowing why.** `s.state` is read on both
sides, but neither side names the piles it excludes: JS asks `state === ACTIVE`
and `Book.spellOfTheDay` asks `state != "active"`. That is why the shelf —
a third value of `state` — reached the widget with no Kotlin change at all.
Written the other way round, as a test for `graveyard`, it would have shipped a
widget that draws shelved spells. Phrase any future test the same way.

For #1, #2, #3, #7 and #8 the honest answer is this register plus a comment on
each side pointing at its twin, rather than machinery to collapse them.
