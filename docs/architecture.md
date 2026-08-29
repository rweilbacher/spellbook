# Architecture

## Two halves

A single `MainActivity` hosting a WebView, and a web app served from
`app/src/main/assets/` over `https://appassets.androidplatform.net` by
`WebViewAssetLoader`. The page owns the book and the whole interface. Kotlin
owns everything a page can't do: the filesystem, the microphone, alarms, the
home screen widget.

They meet at `window.Android` and `window.onNative`, and nowhere else. The full
contract is in `bridge.md`.

**Preview mode is a real mode.** Open `index.html` in a desktop browser and the
app runs with `Bridge === null`: the book lives in memory, recording and
reminders are absent rather than broken, and a banner in the Vault says so.
This is what the test suite drives, and it is why every bridge call is guarded.

**No build step, anywhere.** No bundler, no transpile, no JSX. The file you
edit is the file that runs. The nine asset files load as plain script and link
tags and share one global namespace — which is exactly what the single file did
before it was split, so nothing about how the code talks to itself changed.

## Boot

`boot()`, at the top of the inline script in `index.html`:

1. **`Store.load()`** answers with a state, not a book:
   `missing` · `ok` · `corrupt` · `unreadable`. With the bridge present it asks
   `Bridge.bookState()` first, because `load()` alone cannot tell a first run
   from an I/O failure.
2. **`corrupt` or `unreadable` stops here.** `showRecovery()` replaces the app
   with a screen offering the earlier versions and a file restore, and **nothing
   is written**. A book that parsed but holds no spells counts as corrupt:
   burying or shelving moves a spell's `state`, neither removes one, so zero spells cannot
   be reached through the UI.
3. **`missing` seeds** from `window.SEED` — the only place the seed is used.
4. **`adoptSettings()`** fills settings in from `DEFAULTS` and normalises them.
   Shared with restore, so a restored book gets identical treatment.
5. **`runMigrations()`** runs the migrations the file's `version` says it still
   needs, each still individually guarded.
6. **One `persist()`**, if anything above changed something. Every save is a
   full pipeline on the Kotlin side, and boot used to fire up to six of them.
7. `refreshMedia()`, `sweepMedia()`, `renderAll()`, then `handleOpenRequest()` —
   what a reminder or widget tap wanted the page to land on.

## Storage layout

```
files/
  spellbook.json                  the book. The truth.
  spellbook.json.tmp              write-then-rename, so a crash can't halve it
  backups/
    spellbook-YYYY-MM-DD.json     one a day, seven kept
    pre-restore-YYYYMMDD-HHMMSS.json   written just before a restore, three kept
  media/
    vn_….m4a                      one file per voice note
  last-weekly-export              a timestamp
```

Plus, if a backup folder has been chosen: dated snapshots of the book and a
mirror of `media/` in that folder, at most once a day, riding along on an
ordinary save. See `decisions/0003-no-drive-api.md`.

`save()` is: temp file → rename → daily snapshot → widget refresh → alarm sync,
with the offsite copy handed to a single-thread executor so the page isn't
blocked on a provider that may be a cloud mount.

## The screens

Five `.screen` sections inside `#app`, one visible at a time, plus the nav bar:
**draw** (the sigil, the cast, the revealed cards), **desk**, **library**
(the book, search, sort, and the two other piles — the shelf and the graveyard),
**tags**, **vault** (everything else).
Modal work happens in one bottom `.sheet` at a time.

`#recovery` sits outside `#app` and replaces it entirely. That is deliberate:
every other screen leads to a write, and a write would land on the evidence.

`window.appBack()` is the Android back button, unwinding one layer at a time —
sheet, then library filters, then tag edit mode, then back to the draw screen —
and returning `false` only from a bare draw screen, which is the one place the
app is allowed to close.

## Rendering

Everything is a template literal into `innerHTML`, with `esc()` on anything
that came from the book and `fmt()` for the three markup forms. Card
interactions are delegated from one listener on `document`, matched on
`[data-act]` — so replacing a card's element never loses its handlers.

`patchCard(s, el)` is the only way a card is redrawn in place. It carries over
what belongs to the element rather than to the spell: the entrance animation
doesn't replay, an open source panel stays open, and the badge keeps its kind.

## Performance

48 seeded spells; a real book is around 150. `pool()` runs on every render and
that is free. The JSON is roughly 100KB and is rewritten on every edit, which
is exactly why audio never goes in it.
