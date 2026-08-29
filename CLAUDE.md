# Working on Spellbook

The short version of what you have to know before changing anything here.

## The repo

```
app/src/main/assets/       the app itself
  index.html               markup, model, boot, draw, card, notes, filters,
                           library, tags, vault, desk, editor, import, nav
  css/app.css              the whole stylesheet
  js/seed.js               generated fixture — see below
  js/store.js              Bridge detection, Store.load/save/snapshots
  js/util.js               $, esc, fmt, toast, allTags…
  js/voice.js              voice notes + window.onNative
  js/reminders.js          the daily reminders
  js/backup.js             the chosen backup folder
  js/sheet.js              the bottom sheet
app/src/main/java/com/spellbook/
  MainActivity.kt          the WebView host, permissions, emit()
  SpellbookBridge.kt       every @JavascriptInterface method
  VoiceRecorder.kt         recording, routing, the headset
  Reminders.kt             alarms and notifications
  SpellWidget.kt           the home screen widget
  Backups.kt               the chosen backup folder
tools/smoke.mjs            the test suite
docs/                      design, architecture, bridge, data format, roadmap
docs/decisions/            why things are the way they are
```

Scripts load in the order listed, then the inline block in `index.html`, which
ends with `boot()`. Only one ordering constraint: the inline block goes last,
because it wires DOM handlers and boots.

## How to verify a change

```bash
cd tools && npm install && cd ..
node tools/smoke.mjs
```

Ninety-odd assertions, about seven seconds, most of it Chromium starting.
**Run it before claiming anything works.** It drives the real `index.html`,
first with no bridge (preview mode) and then against a scriptable fake bridge
that can be told to hand back a valid book, garbage, or a failure.

No APK is needed to test. The build question and the testing question are
independent.

## The invariants

**A change must work in two environments.** Inside the WebView, with the bridge
present; and in a plain `file://` or `http://` preview where `Bridge === null`,
there is no storage, no recording and no reminders. Anything assuming the bridge
must be guarded — that is what `canRecord()` and every `if(Bridge)` are for.

**Eight things are implemented twice** across the language boundary. See
`docs/bridge.md`. Changing one side without the other is the likeliest way to
break this app.

**`js/seed.js` is generated and synthetic.** Never hand-edit it; never paste
real spells into it. It is built as a test fixture — it deliberately carries
every situation tag, all four form tags, every computed tag, the three markup
forms, multi-line text, a >300-character spell, accented characters, HTML
metacharacters, all three source origins, both note types and three buried
spells. Assertions depend on all of that.

**Never seed over a book that exists.** `Store.load()` answers with a state —
`missing` · `ok` · `corrupt` · `unreadable` — and only `missing` may be seeded
and saved. The other two render the recovery screen and write nothing at all:
the bad file is the only evidence of what happened and may be salvageable.

**The migration convention.** One-shot, guarded by the field it fixes,
commented with why, and returning whether it changed anything — `boot()` does a
single `persist()` for the whole of boot. Add one to `runMigrations()` and bump
`SCHEMA` in the same commit.

**Three load-bearing principles**, from `docs/design.md`:

- Derived properties are never stored. Computed tags, desk decay, the widget's
  day-seeded pick — all recomputed, so an edit can't leave them lying. The one
  exception is `doc.tags`, the tag vocabulary: a tag with no members has to
  keep existing, or the filter set on it can't be cleared. Its *count* is
  still derived. See `docs/decisions/0008`.
- The JSON file is the truth. It is what makes the widget and boot-time
  reminders possible without the WebView.
- Nothing leaves the device unless you ask.

## What not to touch

- **The Kotlin**, beyond what a feature actually needs. Six small files, one job
  each, comments carrying real knowledge — `VoiceRecorder.kt` in particular.
- **No build step.** The reason this project moves at nineteen commits a day.
  The file you edit is the file that runs. Keep it that way.
- **Performance.** 46 seeded spells, ~150 in a real book. `pool()` running on
  every render is free. Resist optimising it.
- **The prose.** The comments and the specs are the most valuable artefacts
  here. Reorganise them; don't rewrite them.
