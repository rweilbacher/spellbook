# Refactor plan

Working document for the implementer. Opened 2026-08-28; revised as work lands.

All five decisions are **answered** — they're logged below as a record, not as
open questions. Four items are **done**; four remain.

Line numbers refer to the files as they stand *after* the structural pass.
They were re-derived on 2026-08-28 and will drift again; re-check before
trusting one.

---

## Where this stands

| | Item | Status |
|---|---|---|
| R4 | Verification loop — `tools/smoke.mjs` | **Done** · 37 checks green |
| R5a | Duplicate `@keyframes pulse` (F5.1) | **Done** |
| R2 | Synthetic seed, moved to its own file | **Done** |
| R3a | Partial split — 8 cold files extracted | **Done** |
| **R1** | **Make the book recoverable** | **Next** — needs Kotlin, so needs a build |
| R6 | Cross-boundary duplication register | To do |
| R7 | Documentation restructure | To do |
| R5 | Remaining hygiene (F5.2 – F5.11) | Backlog |
| R3b | The rest of the split | Optional — only if a file starts to hurt |
| — | Purge the old seed from git history | Ready to run; commands at the end |

### Measured, after the pass

| | Before | After |
|---|---|---|
| `index.html` | 2,133 lines · 169,016 chars · ~49.7k tokens | **1,355 lines · 64,203 chars · ~17.3k tokens** |
| Seed | 148 real spells · 66,976 chars · one line | 46 synthetic · 18,816 chars · one per line |
| Files in `assets/` | 1 | 9 |
| Automated checks | 0 | 37 |
| Kotlin | 6 files · 1,699 lines | unchanged |

Token figures are character-count estimates, not a tokeniser run. ±15%.

---

## Decisions — all answered

**D1 · What ships as the seed?** → **Synthetic, representative data**, committed
normally (no gitignore). Best of the three options considered: it removes the
privacy problem at the source, makes the staleness problem structurally
impossible, keeps a fresh install immediately usable, *and* gives the test suite
a fixture that doesn't change under it. The real book still needs the import
fixes in R1 either way.

**D2 · Plain script tags or ES modules?** → **Plain tags.** Files talk to each
other through the shared global namespace, exactly as the one big file did.
Zero risk, no build step, and `index.html` still opens directly in a browser.
Modules would give real encapsulation and explicit dependency edges; that stays
available as a separate later decision, and should not be combined with a split
in the same pass.

**D3 · Partial split or full?** → **Partial (R3a).** Eight cold files, 85% of
the token win, and what's left in `index.html` is exactly the hot surface most
tasks need to read anyway.

**D4 · Repo visibility?** → **Stays public**, with the old seed purged from
history. Procedure at the end of this document.

**D5 · Scope and pace?** → Do the structural pass now. Done.

---

## Part 1 — What landed

### R4 · The verification loop — `tools/smoke.mjs`

The app is a web page, so **no APK is needed to test it.** The script serves
`app/src/main/assets/` over loopback and drives the real `index.html` in
headless Chromium with `Bridge === null` — the preview mode the app already
supports and already has a banner for. 37 assertions, ~7 seconds end to end,
most of that Chromium starting.

```bash
cd tools && npm install && cd ..
node tools/smoke.mjs
```

Covers: boot and seed · seed fixture completeness · cast (reveal, `revealed`
class, `drawn` increment) · the useful / desk / source / note quick actions ·
inbox-strip on useful · every tab rendering non-empty · filter narrowing and
clearing · the empty-search state · both branches of the `appBack` contract ·
`fmt`, `cleanTimes` and `weightOf` (the pure functions reimplemented in Kotlin,
see R6) · markup rendering · HTML-metacharacter escaping · both size classes ·
multi-line and non-ASCII text · the graveyard · duplicate `@keyframes` · and it
fails on any console error or warning.

It earned its place twice on the first day: it found F5.1 unprompted on its
first run against unmodified `main`, then caught a fixture coupling in its own
`drawn` assertion when the seed changed underneath it.

**Two gaps it does not cover, both known:**

- *Everything behind the bridge* — persistence, recording, reminders, backups,
  the widget — is invisible, because `Bridge` is null. The fix is a scriptable
  fake bridge, and it's part of R1 below, because the recovery paths are
  precisely the code that must not be wrong and currently cannot be exercised.
- *Anything visual.* It catches a page that errored, not a layout that broke.
  Screenshot comparison is possible with the same tooling if that ever matters.

**Still worth adding:** stylelint for the CSS (the duplicate-keyframes check
here is a stand-in for a real linter); `node --check` over `js/*.js`; and a
second CI job running `npm ci && node tools/smoke.mjs`, which takes well under
a minute and never touches the Gradle path, so a red test can't block an APK
you want anyway.

### R5a · F5.1 — duplicate `@keyframes pulse`

`@keyframes pulse` was defined twice in the same CSS block. The later
definition replaces the earlier one entirely, so the sigil's two inner circles
— which asked for a gentle opacity breath — had been running the voice
recorder's scale-and-fade since voice notes shipped.

Fixed: the recorder's is now `pulse-dot`, and `.vdot.live` points at it.
`css/app.css:83` and `:163`.

### R2 · The seed — `assets/js/seed.js`

46 synthetic spells replacing 148 real ones. Loaded by a plain script tag that
sets `window.SEED`, which works identically inside the WebView and in a
`file://` preview — unlike `fetch('seed.json')` or a module import, both of
which CORS blocks on `file://`.

Written one spell per line so it diffs; the old single 67 KB line was
unreviewable by construction.

**It is built as a test fixture, not filler.** It deliberately carries every
situation tag, all four form tags, every computed tag (`question`, `untagged`,
`useful`), the three markup forms, multi-line text, a >300-character spell,
German and French accents, `& <> "` for the escaping path, all three source
origins, both note types, and three buried spells. `desked` is null on every
spell on purpose — a baked timestamp would decay into a different state
depending on when you installed, and the desk should start empty anyway.

One correctness fix went in alongside: `boot()` used `SEED.map(s => ({...s}))`,
a shallow copy, so a seeded spell's `notes` array *was* the seed's array —
adding a note mutated `window.SEED`. Unobservable while the seed was a `const`
read once, but wrong. Now `JSON.parse(JSON.stringify(...))`. `index.html:167`.

**Note:** an existing book is untouched. `boot()` only seeds when there's no
`spellbook.json`, so this never appears on a phone that already has one.

### R3a · The partial split

Eight cold sections extracted; the hot surface stayed inline.

| File | Lines | Chars | Contents |
|---|---|---|---|
| `index.html` | 1,355 | 64,203 | markup, model, boot + migrations, draw, card, notes, filters, library, tags, vault, desk, editor, transfer, nav |
| `css/app.css` | 297 | 17,573 | the whole stylesheet |
| `js/seed.js` | 66 | 18,816 | generated fixture |
| `js/voice.js` | 186 | 8,022 | voice notes + `window.onNative` |
| `js/reminders.js` | 168 | 6,965 | the three daily reminders |
| `js/backup.js` | 48 | 2,700 | the chosen backup folder |
| `js/sheet.js` | 42 | 1,744 | the bottom sheet |
| `js/util.js` | 40 | 1,615 | `$`, `esc`, `fmt`, `toast`, `allTags`… |
| `js/store.js` | 25 | 1,060 | `Bridge` detection, `Store.load/save` |

Load order: the eight files, then the inline block, which ends with `boot()`.
Only one ordering constraint — the inline block goes last, because it wires DOM
handlers and boots. Top-level `let`/`const` in classic scripts share the global
lexical environment, so nothing else needed changing.

**Verified beyond the suite:** concatenating the extracted files back together
and diffing against the original script block yields exactly one differing line
(the intentional seed change); the CSS is identical apart from the R5a rename;
and screenshots of the draw, book and vault screens confirm the external
stylesheet renders.

**Not yet verified: the APK.** Confirmed working in Chromium, not in the
WebView. The specific risk is whether `WebViewAssetLoader` serves the new
subdirectories — `AssetsPathHandler` should handle the whole `/assets/` tree,
but build one and open it before trusting this.

**Build cost, since it comes up:** Gradle time is unchanged (assets are copied
verbatim). There is no JS build step, before or after — no bundler, no
transpile, the file you edit is still the file that runs. Cold start gains 8
asset reads instead of 1, each a local `AssetManager` open; against WebView
init's few hundred milliseconds that's noise. Measure it anyway when you next
build, since cold start is user-facing when the widget is tapped.

---

## Part 2 — Next · R1, make the book recoverable

**The highest-value item left, and the only one needing Kotlin** — so it needs
a working build to verify, and it should start by giving the test suite a way
to see behind the bridge at all.

Five findings chain into one failure. Fixing any one alone leaves the chain
intact.

### F1.0 — Build the fake bridge first

Everything below is invisible to the current test suite, because `Bridge` is
null in Chromium. Inject a scriptable stub `window.Android` before boot — with
a `load()` that can be told to return valid JSON, garbage, or throw, and a
`save()` that records what it was given — and every branch of F1.1 and F1.2
becomes a test that runs in a second. Do this before the fixes, not after.

### F1.1 — An unreadable book is indistinguishable from no book

`js/store.js:14–22`

```js
load(){
  try{
    const raw = Bridge ? Bridge.load() : memory;
    return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  }catch(e){ console.warn('load failed', e); return null; }
}
```

`SpellbookBridge.load()` (`SpellbookBridge.kt:37–40`) compounds it: an I/O
failure on an existing file returns `""`, the same answer as "there is no
book". So three states collapse into `null`:

- no file at all (first run) — seeding is correct
- file exists, won't parse (truncated write, bad hand-edit, full disk) — **seeding is destructive**
- file exists, unreadable (permissions, I/O) — **seeding is destructive**

**Fix.** Give Kotlin a state answer and let JS branch on it.

```kotlin
/** "missing" | "ok" | "unreadable" — so the page can tell a first run
 *  from a book it must not overwrite. */
@JavascriptInterface
fun bookState(): String = when {
    !book.exists() -> "missing"
    runCatching { book.readText() }.isSuccess -> "ok"
    else -> "unreadable"
}
```

`Store.load()` returns a discriminated result instead of `null`:
`{state:'missing'}` / `{state:'ok', doc}` / `{state:'unreadable'}` /
`{state:'corrupt'}` (parsed and threw). Preview mode with no bridge maps to
`missing` when `memory` is null, preserving today's behaviour exactly.

### F1.2 — `boot()` overwrites the file it could not read

`index.html:164–171`

```js
doc = Store.load();
if(!doc || !Array.isArray(doc.spells) || !doc.spells.length){
  doc = { version:1, …, spells:JSON.parse(JSON.stringify(window.SEED || [])) };
  Store.save(doc);          // ← writes over the unreadable book
}
```

**Fix.** Seed and save only on `missing`. On `corrupt` or `unreadable`, do not
call `Store.save()` at all — render a recovery screen (F1.5) and stop. Leave
the bad file exactly where it is; it may be partly salvageable and it's the
only evidence of what happened.

`!doc.spells.length` should also stop triggering a seed. There's no way to
reach zero spells through the UI (burying moves `state`, it doesn't remove), so
a zero-length parsed book is itself a corruption signal, not a first run.

### F1.3 — Import cannot restore counts

`index.html:1243–1291`. Already documented in `spellbook-features.md` under
**Bugs**.

`importBook` merges by id and deliberately never writes `useful`, `drawn`,
`lastDrawn` or `state` on an existing spell. Correct when merging someone
else's spells; wrong when restoring your own book, because after F1.2 the ids
all exist and every counter stays at zero.

**Fix** — the split already specced under *Two kinds of import*:

- **Restore from backup.** Replaces `doc` wholesale — spells, counters,
  graveyard state, `settings`. Confirm explicitly. Write the current book to
  `backups/` first (`pre-restore-<stamp>.json`) so a mistaken restore is itself
  reversible.
- **Merge spells.** As now, with two changes: counters take
  `Math.max(stored, incoming)` rather than being skipped, and a spell already
  in the graveyard is never resurrected by a merge.

### F1.4 — Exported settings are written and never read back

`exportBook` (`index.html:1230–1241`) writes `settings: S` into the file.
`importBook` (`:1243`) reads `parsed.spells` and never touches
`parsed.settings`.

So a restore loses `notifyTimes`, `notifyText`, `inboxWeight`, `flaggedWeight`,
`tagKindOverrides`, `include`/`require`/`exclude`, `sort`, `drawCount`,
`noRepeat`, `btMic`. `tagKindOverrides` is the worst: without it every tag
reverts to its `SITUATIONS`-membership default and the filter sheet
reorganises itself.

**Fix.** Restore applies `settings` through the same
`Object.assign({}, DEFAULTS, incoming)` path `boot()` uses, then re-runs
`cleanTimes()` and the migrations. Merge continues to ignore settings — that's
correct, they belong to the phone.

### F1.5 — `files/backups/` is unreachable from the app

`SpellbookBridge.kt:32` defines `backupDir`; `rollBackup` (`:63–73`) writes
into it; **nothing reads it**. Seven daily snapshots exist that the user cannot
get at without adb.

**Fix.** Two bridge methods and one Vault entry.

```kotlin
/** Dated snapshots in files/backups/, newest first:
 *  [{"name":"spellbook-2026-08-27.json","at":1787…,"bytes":102400,"spells":148}] */
@JavascriptInterface
fun snapshots(): String

/** Read one back. Returns the JSON text, or "" if the name isn't one of ours. */
@JavascriptInterface
fun readSnapshot(name: String): String
```

Validate `name` against `^spellbook-\d{4}-\d{2}-\d{2}\.json$` before touching
the filesystem — the same discipline as `VoiceRecorder.safeName`.
`readSnapshot` returns text; the page runs it through the same **Restore** path
as F1.3, so there is one restore implementation, not two.

Surface as **Vault → Keeping → Earlier versions**, listing date and spell
count. Also reachable from the recovery screen in F1.2, which is the case it
exists for.

### F1.6 — `doc.version` has never moved

`index.html:167` writes `version:1`. Five migrations have shipped since
(`index.html:199–275`), each gated on a different signal — field presence for
four, a doc-level `inboxSeeded` flag for the fifth.

The pattern works and shouldn't be replaced. But once Restore exists, a file of
unknown vintage can arrive from anywhere, and `version` is what lets the
restore path decide which migrations to run rather than running all five and
trusting their guards.

**Fix.** Introduce `SCHEMA = 2`, stamp it on every `persist()`, and run
migrations forward from `doc.version`. Keep the per-field guards as
belt-and-braces for books written before the stamp existed.

### R1 verification

With the fake bridge, most of this is automatable:

- Feed `load()` truncated JSON → recovery screen shown, and `save()` was never
  called.
- Feed it a valid book → no seeding, counts intact.
- Restore from a snapshot → `useful`, `drawn` and `notifyTimes` all come back.
- Merge a foreign export → counters take the max, buried spells stay buried.

On a real device: corrupt `spellbook.json`, confirm the file is
**byte-identical** afterwards.

---

## Part 3 — Then · R6 and R7, the writing

### R6 · Cross-boundary duplication register

Eight things exist in both halves with nothing keeping them in step. Not a bug
list — the register that should live in `docs/bridge.md`, so the next change to
either side knows what it has to mirror.

| # | Duplicated | JavaScript | Kotlin | Collapsible? |
|---|---|---|---|---|
| 1 | `**bold**` / `*italic*` / `==highlight==` | `fmt()` — `js/util.js:15–20` | `SpellWidget.MARKUP` + `styled()` — `:142–181` | No — different render targets |
| 2 | Weighted pick | `weightOf` / `weightedIndex` — `index.html:314–331` | `Book.weighted` + inline weighting — `:266–309` | No — Kotlin's must stay deterministic |
| 3 | Tag names `inbox` / `flagged` | `index.html:95–96` | `Book.INBOX` / `FLAGGED` — `:237–238` | No |
| 4 | Default draw weights (3 / 1) | `DEFAULTS` — `index.html:90` | `Book.spellOfTheDay` fallbacks — `:246–247` | Partly |
| 5 | Reminder cap of 3 | `NOTIFY_MAX` — `index.html:92` | `Reminders.MAX` — `:37` | **Yes** |
| 6 | Default reminder text | `DEFAULTS.notifyText` — `index.html:91` | `Reminders.DEFAULT_TEXT` — `:39` | **Yes** |
| 7 | Colour palette | `:root` — `css/app.css:2–10` | `res/values/colors.xml` (whose comment asks you to keep it in step by hand) | No |
| 8 | Media filename shape | trusted implicitly | `VoiceRecorder.SAFE` — `:347` | No — Kotlin's is the security boundary |

\#5 and \#6 are free wins: `SpellbookBridge.notifyState()` (`:197–204`)
**already sends both values across the bridge** and the page ignores them,
using its own constants. Consume what's already there. For the rest, the
register plus a comment on each side pointing at its twin is the realistic
answer.

Three of these — `fmt`, `cleanTimes`, `weightOf` — now have tests on the JS
side. The Kotlin twins don't.

**The bridge contract itself**, for `docs/bridge.md`:

- **Out (JS → Kotlin), 18 `@JavascriptInterface` methods:** `load`, `save`,
  `export`, `startVoiceNote`, `stopVoiceNote`, `cancelVoiceNote`,
  `bluetoothMicAvailable`, `mediaList`, `deleteMedia`, `pruneMedia`,
  `notifyState`, `requestNotifyPermission`, `openNotificationSettings`,
  `openRequest`, `backupInfo`, `pickBackupFolder`, `clearBackupFolder`,
  `backupNow`. R1 adds `bookState`, `snapshots`, `readSnapshot`.
- **In (Kotlin → JS), one channel:** `window.onNative(jsonString)`
  (`js/voice.js:103–154`), with `kind` ∈ `backup` | `open` | `notify` |
  `voice`, and for `voice` a `type` ∈ `routing` | `fellBack` | `started` |
  `level` | `route` | `saved` | `tooShort` | `cancelled` | `denied` | `error`.

Document each payload shape, and the guarantee that `Bridge` may be `null`
(preview mode) for every one of them.

### R7 · Documentation restructure

No rewriting. Moving paragraphs you've already written into files whose names
say what they are, plus three that don't exist.

**The diagnosis.** `spellbook-features.md` (508 lines) does four jobs:

- **Reference** — *Principles* and *The vocabulary* (`:11–35`). The most
  durable writing in the repo, filed above a changelog.
- **Shipped** (`:43–83`) — 40 flat chronological entries where later ones
  contradict earlier ones (`:65` describes `needs-review`, `:74` renames it;
  `:57` and `:67` describe two incompatible filter models). Reading top to
  bottom is currently the only way to learn what the app does today. That's a
  changelog doing a reference's job.
- **Specs** (`:125–497`) — architecture decision records in all but name.
- **Queue** (`:91–121`) — a roadmap.

`README.md` has drifted from build/install instructions into feature
explanation (widget, reminders, backup folder), duplicating the features doc.
It also now needs updating for the split — "the only file you normally touch is
`index.html`" is no longer quite true.

**Target tree:**

```
README.md              build, install, keystore, where data lives. Short.
CLAUDE.md              repo map, invariants, how to verify a change
CHANGELOG.md           ← "Shipped", unchanged, correctly labelled
docs/
  design.md            ← Principles + The vocabulary
  architecture.md      the two halves, boot sequence, storage layout
  bridge.md            the full contract, both directions (R6)
  data-format.md       spellbook.json schema, versioning, migration rules
  roadmap.md           ← Queue + the specs not yet built
  decisions/
    0001-json-not-indexeddb.md
    0002-recording-in-kotlin.md
    0003-no-drive-api.md
    0004-inexact-alarms.md
    0005-inbox-as-tag-not-state.md
    0006-recording-not-dictation.md
    0007-widget-derives-its-pick.md
```

Each ADR lifts almost verbatim from the matching spec section — the "rejected
because" paragraphs are already written and are the best content in the repo.
Give each a *Status* line, so a superseded decision is visible as such, which
is the thing a flat Shipped list can't express.

**`CLAUDE.md` — the invariants to state.** Cheapest file to write, probably the
highest-leverage. At minimum:

- Repo map: `index.html` + `js/*.js` + `css/app.css` in
  `app/src/main/assets/`; six Kotlin files in `app/src/main/java/com/spellbook/`.
- **A change must work in two environments**: inside the WebView (bridge
  present) and in a plain `file://` preview (`Bridge === null`, no storage, no
  recording, no reminders). Anything assuming the bridge must be guarded —
  that's why `canRecord()` and `if(Bridge)` exist.
- **How to verify**: `node tools/smoke.mjs` before claiming anything works.
- **Eight things are implemented twice** across the language boundary — see
  `docs/bridge.md`. Changing one without the other is the likeliest way to
  break this app.
- **`js/seed.js` is generated and synthetic.** Never hand-edit; never paste
  real spells into it.
- The migration convention: one-shot, guarded, commented with why, `persist()`
  only if something changed.
- The three load-bearing principles: derived properties are never stored; the
  JSON file is the truth; nothing leaves the device unless asked.

---

## Part 4 — Backlog · R5, the rest of the hygiene

Ordered by whether they're wrong or merely untidy. None are urgent.

**F5.2 — four copies of the tag strip.** `index.html:405` (in `card()`),
`:473` (useful handler), `:488` (flag handler), and the near-identical `:1210`
in `triage()`. Extract `tagsHtml(s)` and call it from all four. This is the
worst remaining uniqueness problem for exact-match editing.

**F5.3 — two rendering strategies for the same state change.** `redrawCard()`
(`index.html:1319`) replaces `outerHTML`; the useful and flag handlers
(`:461–500`) hand-patch individual nodes to avoid restarting the entrance
animation. Both are reasonable; having both is the problem, and they've already
drifted — the useful handler removes the `.badge.untested` element and rebuilds
the tag strip, the flag handler does the same in a different order and doesn't
update the `useful` count node. Fix: one `patchCard(s, {animate:false})` used
everywhere. Check the pin animation (`.act.pinned`) still lands — it runs on
the button, not the card, so it should survive.

**F5.4 — the reminders sheet is identified by its title text.**
`js/voice.js:126–128` does `if(open.textContent === 'Reminders')`. Rename the
sheet's copy and the notification-permission refresh silently stops working.
Give `sheet()` a `data-sheet="reminders"` attribute and match on that. While
there: `sheet._onClose` as a static property on a function, and the inline
`onclick="closeSheet()"` in `js/sheet.js` (the only inline handler in the
codebase, requiring the `window.closeSheet` export), are both worth tidying.

**F5.5 — `'inbox'` as a bare literal, eight times.** `INBOX` is declared at
`index.html:95` and used four times; the literal appears at `:257`, `:258`,
`:463`, `:464`, `:482`, `:483`, `:1116`, `:1274`. Same for `'graveyard'` (six
literals, no constant) and `'active'`. Mechanical, but it's what makes a rename
fail halfway.

**F5.6 — 45 inline `style="…"` attributes in template literals.** The design
system in `:root` is only half-honoured; restyling means grepping template
literals. The `on`/`off` state toggles are worth converting first — they're the
ones carrying real meaning, and they'd become `.tagbtn.picked` /
`.factitem .nm.required`.

**F5.7 — `esc()` doesn't escape `'`, and one selector uses raw input.**
`js/util.js:10` covers `& < > "`; every attribute is double-quoted, so that's
safe. But `index.html:1168` builds a selector from the unescaped tag:
`$(\`#eTags [data-t="${t}"]\`)`. Tag input is normalised with
`.trim().toLowerCase().replace(/\s+/g,'-')`, which leaves `"` intact — a tag
containing a quote throws `SyntaxError` from `querySelector` and the keydown
handler dies. Self-inflicted only; `CSS.escape` or rejecting the character on
input fixes it.

**F5.8 — Kotlin: a no-op with a misleading comment.** `MainActivity.kt:309–310`
evaluates `void 0` under a comment claiming it flushes WebView caches. It
flushes nothing. Delete both lines, or write the thing that was meant. A
comment asserting something untrue is worse than no comment.

**F5.9 — Kotlin: `save()` does heavy work on the caller's thread.**
`SpellbookBridge.save()` (`:43–61`) runs synchronously on the binder thread the
JavaScript caller is blocked on: write temp → rename → `rollBackup` (a second
full write) → `offsite` → `SpellWidget.refresh` → `Reminders.syncFrom`. Most
days `offsite` is gated and cheap, but on the first save of a day with a backup
folder set, `Backups.writeNow` runs inline — a SAF `createFile`, a full JSON
write, and a walk of the media directory across a provider that may be a cloud
mount. `persist()` fires on every card action, so the user experiences it as a
random tap that hangs. Fix: move `offsite()` onto a single-thread executor (it
must not run concurrently with itself) and let `save()` return once the book is
on disk. `backupNow()` stays synchronous — the page waits and reports, which is
the documented intent.

**F5.10 — boot writes the book up to six times.** `boot()`
(`index.html:164–189`) calls `Store.save()` for the seed, then each of five
migrations may `persist()`. Every one runs the full pipeline in F5.9. Run
migrations against an in-memory doc with a dirty flag, and `persist()` once at
the end. Folds naturally into R1, which is rewriting boot anyway.

**F5.11 — minor.** `card()` emits `animation-delay:undefinedms` when called
with `{delay:undefined}` (`index.html:401`; invalid, ignored, but a smell that
`delay:undefined` means "no animation") · `sourceHtml()` puts `<dt>`/`<dd>`
inside a bare `<div>` with no `<dl>` (`:445`; works everywhere, invalid) ·
`#toast` is two separate rule blocks with `#toast.high` between them
(`css/app.css:273` and `:277`) · the `recent` no-repeat window
(`index.html:160`) is in-memory only and resets every launch, already noted in
the features doc under *Weighted draw*.

---

## Part 5 — Optional · R3b, the rest of the split

Only if a remaining section starts to feel too big. `vault` (7.2 KB) and `card`
(6.4 KB) are the next candidates and can each be extracted individually without
redoing anything.

The one piece that isn't a straight cut: `window.onNative` (`js/voice.js`)
handles `backup`, `open` and `notify` as well as `voice`, and its voice branch
is inside the same function body. Splitting it means moving the whole function
into a `js/native.js` and replacing the voice branch with a call to a
`handleVoiceEvent(e)` lifted into `voice.js`. Worth doing when the bridge
contract gets documented (R6), so the inbound half has one home next to
`store.js`, which owns the outbound half.

---

## Reference

### What not to touch

- **The Kotlin.** Six small files, one job each, comments carrying real
  knowledge — `VoiceRecorder.kt` in particular. The only changes wanted are
  R1's bridge additions and F5.8 – F5.9.
- **No build step.** The reason this project moves at nineteen commits a day.
  The split didn't cost it and nothing else should.
- **JSON as truth.** What makes the widget and boot-time reminders possible.
- **Derived, not stored.** Computed tags, desk decay, the widget's day-seeded
  pick. Keeps state small and migrations rare.
- **The migration convention.** It works; it needs a schema version to lean on
  (F1.6), not replacing.
- **Performance.** 46 seeded spells, ~150 in a real book. `pool()` running on
  every render is free. Resist optimising it.
- **The prose.** The comments and specs are the most valuable artefacts here.
  Reorganise them (R7); don't rewrite them.

### Environment notes

**The Linux workspace on this device does not start.** `device_bash` returns
*"the isolated Linux environment on this device failed to start"*, so all repo
access has gone through stage/commit rather than a shell. The device is Windows
(`win32`, desktop app 1.37937.3) and that workspace is WSL2-backed, so the
usual causes are WSL not installed or not enabled, virtualisation off in
firmware, or a broken/updating kernel. `wsl --status` and `wsl --update` in an
admin PowerShell are the things to check. If it comes back, in-place editing
becomes possible instead of copying files back and forth.

**Local builds — three options, only one needing WSL.**

1. *Cloud container* (available now, no WSL). Android SDK command-line tools
   plus JDK 17 installed there, `gradle assembleDebug` against the staged repo,
   APK committed straight back. Faster than the GitHub Actions round trip.
   Costs a few minutes of SDK download per session, since the container is
   ephemeral. Untested; needs `dl.google.com` and `maven.google.com` reachable.
2. *Android Studio or plain Gradle on Windows* (no WSL, no me). By far the
   fastest inner loop, and the real answer to not wanting the Actions round
   trip. CI then becomes what it should be — the clean-machine check, not the
   only way to get an APK.
3. *The WSL workspace, once it starts.* Needs the SDK inside that VM, and its
   network follows session egress settings. Least certain of the three.

**None of this is needed to test.** R4 runs against `app/src/main/assets/` in
headless Chromium and never builds an APK. The build question and the testing
question are independent.

### Purging the old seed from history

D4: **stays public, history purged.** `index.html` no longer contains the seed,
so the only copies left are historical — the forward leak is already closed and
none of this is urgent.

These can't be run from here (no shell on the device; a force-push needs your
credentials). **Take a backup first:** `git clone --mirror` somewhere safe.

**Step 0 — find every copy, not just the obvious one.**

```bash
# Which commits ever touched a seed line, and what shape was it in?
git log --all --oneline -S'const SEED' -- app/src/main/assets/index.html

# Was a built APK or zip ever committed? Both embed the seed.
# (.gitignore covers them now, but it arrived in commit 4 of 20.)
git log --all --diff-filter=A --name-only --format= | sort -u | grep -iE '\.(apk|zip)$'

# Any spell text that leaked into other files?
git log --all -S'sp_9e539136' --oneline        # a real id from the old seed

# Five biggest blobs in history — a stray APK shows up here immediately.
git rev-list --objects --all \
  | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
  | awk '$1=="blob"' | sort -k3 -n -r | head -5
```

**Step 1 — rewrite, keeping the commit history.** `git-filter-repo` is the
maintained tool (`filter-branch` is deprecated and far slower; the BFG is fine
but less precise). It preserves your 19 commit messages, which is why it beats
an orphan commit.

```bash
pip install git-filter-repo
cd /tmp && git clone https://github.com/rweilbacher/spellbook.git purge && cd purge

cat > expressions.txt <<'EOF'
regex:const SEED = \[\{"id".*\];==>const SEED = [];
EOF

git filter-repo --replace-text expressions.txt
# add --path app-debug.apk --invert-paths (etc.) if step 0 found committed binaries
```

Adjust the regex if step 0 shows the seed took a different shape in early
commits. Verify **before** pushing:

```bash
git log --all -S'sp_9e539136' --oneline                        # must print nothing
git grep -I 'const SEED = \[{' $(git rev-list --all) | head    # must print nothing
```

**Step 2 — get it off GitHub for real.** The part that gets skipped and matters
most: a force-push does **not** remove old objects from GitHub. Unreachable
commits stay retrievable by SHA for a long time, and cached diff views can
outlive them. Two ways to close it, in order of certainty:

- **Delete the repository and recreate it** (Settings → Danger Zone), then push
  the rewritten history to the fresh remote. Guarantees no dangling objects.
  Costs the Actions run history and any stars/issues/watchers — check what
  you'd lose; for a personal repo it's usually nothing.
- **Force-push, then ask GitHub Support to garbage-collect** the repository and
  purge cached views. They do this on request; slower, and you're trusting a
  process rather than a deletion.

Either way, **check for forks first** (`Insights → Forks`). A fork keeps its own
copy and GitHub will not rewrite someone else's repository.

```bash
git remote set-url origin https://github.com/rweilbacher/spellbook.git
git push --force --all && git push --force --tags
```

Afterwards, clone fresh somewhere and grep *that*, rather than trusting the
local rewrite. Your working copy at
`C:\Users\Roland\Google Drive\Projects\spellbook` will need re-cloning or a hard
reset, since every commit SHA changes.

**Step 3 — what stays.** `spellbook-features.md` quotes a handful of
spell-like lines as examples (*watch your feet*, *what's the vulnerable
thing?*, the invented dark-spell examples). Those are illustrations in a design
document, not the book. Fine to leave unless you'd rather they weren't there.
