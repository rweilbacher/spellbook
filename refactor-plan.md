# Refactor plan

Working document for the implementer. Written 2026-08-28 against `main` at
"widget tap now goes to spell detail". Revised the same day after review.

Every line number refers to `index.html` as it stands at the commit above —
re-check them if the file has moved on.

## Status

**Landed** — all verified by `tools/smoke.mjs`, **37 checks, 0 failures**:

- **R4** — the smoke test. No APK required; ~7s. Found F5.1 unprompted on its
  first run, then caught a fixture coupling in its own `drawn` assertion when
  the seed changed. Now 37 checks.
- **R5a** — F5.1 fixed. `@keyframes pulse` → `pulse-dot` for the recorder dot,
  so the sigil gets its intended opacity breath back.
- **R2 + D1** — the seed is synthetic and lives in `assets/js/seed.js`.
  46 spells, 18.8 KB (was 148 spells, 67 KB). Covers every situation tag, all
  four form tags, every computed tag, the three markup forms, multi-line,
  >300-character and non-ASCII text, HTML metacharacters, all three source
  origins, both note types, and the graveyard — so the test suite has a fixture
  that asserts against it rather than around it.
- **R3a + D2 + D3** — partial split, plain script tags. Eight cold files
  extracted: `css/app.css`, `js/seed.js`, `js/store.js`, `js/util.js`,
  `js/voice.js`, `js/backup.js`, `js/reminders.js`, `js/sheet.js`.
  **`index.html`: 2,133 → 1,355 lines, ~49.7k → ~17.3k tokens.**

Verification beyond the suite: concatenating the extracted files back together
and diffing against the original script block gives exactly one differing line
(the intentional seed change), and the CSS is identical apart from the R5a
rename. Screenshots of the draw, book and vault screens confirm the external
stylesheet renders.

**Next up:** R1 (recovery) — the highest-value item and the only one that needs
Kotlin, so it needs a build to verify. Then R6/R7 (docs), then the rest of R5.

**Still open:** D4 — see *Purging the seed from history*, below.

---

## 0. Measured state

| | |
|---|---|
| `app/src/main/assets/index.html` | 2,133 lines · 166,884 chars |
| — CSS (lines 8–305) | 298 lines |
| — body markup (307–376) | 70 lines |
| — script (378–2,130) | 1,753 lines |
| — of which line 400, `const SEED` | **66,975 chars — 40.1% of the file, on one line, 148 spells** |
| Estimated cost to read the file | ~49k tokens; ~20k of that is the seed |
| Kotlin | 6 files, 1,699 lines |
| Automated checks | none — CI runs `assembleDebug` and uploads the APK |
| Commits in the 26h before this review | 19 |

Token figures are character-count estimates, not a tokeniser run. ±15%.

---

## R1 — Make the book recoverable

**Priority: do this first.** It is independent of every other item and closes a
live data-loss path. Three findings chain into one failure; fixing any one of
them alone leaves the chain intact.

### F1.1 — An unreadable book is indistinguishable from no book

`index.html:386–398`

```js
load(){
  try{
    const raw = Bridge ? Bridge.load() : memory;
    return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  }catch(e){ console.warn('load failed', e); return null; }
}
```

`SpellbookBridge.load()` (`SpellbookBridge.kt:37–40`) compounds it:

```kotlin
fun load(): String = runCatching {
    if (book.exists()) book.readText() else ""
}.getOrDefault("")
```

An I/O failure on an existing file returns `""` — the same answer as "there is
no book". So three distinct states collapse into `null`:

- no file at all (first run) — seeding is correct
- file exists, won't parse (truncated write, bad hand-edit, disk full) — **seeding is destructive**
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

In `Store.load()`, return a discriminated result rather than `null`:
`{state:'missing'}` / `{state:'ok', doc}` / `{state:'unreadable'}` /
`{state:'corrupt'}` (parsed and threw). Preview mode with no bridge maps to
`missing` when `memory` is null, which preserves today's behaviour exactly.

### F1.2 — `boot()` overwrites the file it could not read

`index.html:477–482`

```js
doc = Store.load();
if(!doc || !Array.isArray(doc.spells) || !doc.spells.length){
  doc = { version:1, exportedAt:..., settings:{...DEFAULTS}, spells:SEED.map(s=>({...s})) };
  Store.save(doc);          // ← writes over the unreadable book
}
```

**Fix.** Seed and save only on `missing`. On `corrupt` or `unreadable`, do not
call `Store.save()` at all — render a recovery screen instead (see F1.5) and
stop. Leave the bad file exactly where it is; it may be partially salvageable
and it's the only evidence of what happened.

`!doc.spells.length` should also stop being a seed trigger. There is no way to
reach zero spells through the UI (bury moves state, it doesn't remove), so a
zero-length parsed book is itself a corruption signal, not a first run.

### F1.3 — Import cannot restore counts

`index.html:1982–2030`, and already documented in `spellbook-features.md`
under **Bugs**.

`importBook` merges by id and deliberately never writes `useful`, `drawn`,
`lastDrawn` or `state` on an existing spell (`:2000–2007`). Correct when
merging someone else's spells; wrong when restoring your own book, because
after F1.2 the ids all exist and every counter stays at zero.

**Fix** — the split already specced under *Two kinds of import*:

- **Restore from backup.** Replaces `doc` wholesale — spells, counters,
  graveyard state, `settings`. Confirm explicitly. Write the current book to
  `backups/` first (a new bridge call, or reuse `rollBackup` with a distinct
  name like `pre-restore-<stamp>.json`) so a mistaken restore is reversible.
- **Merge spells.** As now, with two changes: counters take
  `Math.max(stored, incoming)` rather than being skipped, and a spell already
  in the graveyard is never resurrected by a merge.

### F1.4 — Exported settings are written and never read back

`index.html:1969–1980` writes `settings: S` into the export.
`index.html:1982–2030` reads `parsed.spells` and never touches
`parsed.settings`.

So a restore loses: `notifyTimes`, `notifyText`, `inboxWeight`,
`flaggedWeight`, `tagKindOverrides`, `include`/`require`/`exclude`, `sort`,
`drawCount`, `noRepeat`, `btMic`. `tagKindOverrides` is the worst of these —
without it every tag reverts to its `SITUATIONS`-membership default and the
filter sheet reorganises itself.

**Fix.** Restore (F1.3) applies `settings` through the same
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
the filesystem — same discipline as `VoiceRecorder.safeName`. `readSnapshot`
returns the text; the page then runs it through the same **Restore** path as
F1.3, so there is one restore implementation, not two.

Surface as **Vault → Keeping → Earlier versions**, listing date and spell
count. Also reachable from the recovery screen in F1.2, which is the case it
exists for.

### F1.6 — `doc.version` has never moved

`index.html:480` writes `version:1`. Five migrations have shipped since
(`migrateFlagTag`, `migrateFilterSchema`, `migrateDeskField`,
`migrateInboxTag`, `migrateNotesField`, `:512–588`), each gated on a different
signal — field presence for four of them, a doc-level `inboxSeeded` flag for
the fifth.

The pattern works and shouldn't be replaced. But once Restore exists, a file
of unknown vintage can arrive from anywhere, and `version` is what lets the
restore path decide which migrations to run rather than running all five and
hoping their guards hold.

**Fix.** Introduce `SCHEMA = 2`, stamp it on every `persist()`, and run
migrations from `doc.version` forward. Keep the existing per-field guards as
belt-and-braces for books written before the stamp existed.

### R1 verification

- Corrupt `spellbook.json` on a test device (truncate it); confirm the app
  shows the recovery screen and the file is **byte-identical** afterwards.
- Restore from a snapshot; confirm `useful`, `drawn` and `notifyTimes` all
  come back.
- Merge an export from another book; confirm counters take the max and
  buried spells stay buried.

---

## R2 — Move the seed out of `index.html`

Blocked on **D1**.

`index.html:400` becomes `<script src="./seed.js"></script>` before the main
scripts, and `assets/seed.js` contains:

```js
/* Generated — do not hand-edit. See tools/regen-seed. */
window.SEED = [ … ];
```

`window.SEED` rather than `export`/`fetch` on purpose: a plain script tag works
identically inside the WebView and from a `file://` preview, where both
`fetch('./seed.json')` and `type="module"` are blocked by CORS.

`boot()` reads `window.SEED || []`, so a missing or emptied seed file
degrades to an empty book rather than throwing.

Effect on the numbers: `index.html` drops to ~2,000 lines and ~27k tokens.

### D1 shapes what ships in that file

- **Full** — as today, just relocated. Cost and diff noise fixed; privacy and
  staleness unchanged.
- **Empty + gitignored** — `window.SEED = [];` committed, the real file local
  only. Removes 148 personal spells from the repo and from every CI artifact,
  and makes the stale-seed problem structurally impossible. Cost: a fresh
  install shows an empty book until you Import. Given that R1 makes Restore a
  real feature, this is defensible.
- **Dated + regenerated** — a `tools/regen-seed` script that takes an export
  and writes `seed.js` with a `SEED_AT` stamp the empty-state UI can show
  ("seeded from a snapshot of 2026-08-27"). Keeps the convenience, makes the
  staleness visible rather than silent.

Whichever wins: pretty-print it. One spell per line makes the file diffable,
costs nothing at runtime, and is the whole reason line 400 is currently
unreviewable.

---

## R3 — Split the script

Blocked on **D2**. Assumes D2 = plain script tags (the recommended start).

### R3a — The partial split, which is probably the right first move

Roland's instinct — extract only what's rarely touched — is better than the
full split for this repo, and the numbers back it. Sections measured by
character count and sorted by how often a feature lands in them:

| Section | Lines | Chars | Touched |
|---|---|---|---|
| `SEED` | 1 | 66,976 | never (generated) |
| CSS | 298 | 17,514 | rarely — design changes only |
| voice | 181 | 7,763 | rarely — done, and risky to disturb |
| reminders | 163 | 6,742 | rarely — just shipped, stable |
| backup | 43 | 2,484 | rarely |
| sheet | 37 | 1,546 | rarely — infrastructure |
| util | 35 | 1,405 | rarely |
| store | 20 | 824 | rarely |
| **cold subtotal** | | **105,254** | **62.3% of the file** |
| everything else | | 63,726 | draw, card, filters, library, tags, vault, desk, editor, notes, boot, model, nav, markup |

Extracting only the cold sections takes `index.html` from **~50k tokens to
~17k** — about 85% of the win of the full split, for maybe a third of the
motion. Eight new files instead of twenty-one.

There's a second, less obvious argument for stopping there. After R3a the
remaining `index.html` is exactly the hot surface: the screens and the draw
logic, which is what most tasks need to read anyway. A full split means an
agent has to work out *which* of 21 files it needs before it can start; a
partial split means the default read is already correctly scoped, and the cold
files are opened only when the task is actually about voice or reminders.

**Recommendation: do R3a, live with it, and only go further if a specific file
starts feeling too big.** `card` (6.4k) and `vault` (7.2k) are the next
candidates and can be extracted individually later without redoing anything.

The full 21-file map below stays as the reference for what "further" looks
like.

### On build time — it's zero, and that's worth being precise about

Three different costs get conflated here:

- **Gradle build time: unchanged.** Assets are copied verbatim into the APK.
  One file or twenty-one, it's the same byte count and the same task.
- **JS build time: does not exist, before or after.** No bundler, no
  transpile, no `npm run build`. The file you edit is still the file that
  runs. This is the thing worth being explicit about, because "splitting a
  frontend into files" normally implies a toolchain and here it doesn't.
- **App cold start: a few milliseconds.** 8 (or 21) asset reads through
  `WebViewAssetLoader.shouldInterceptRequest` instead of 1. Each is a local
  `AssetManager` open. Against WebView initialisation, which is a few hundred
  milliseconds, it's noise. Measure it anyway — cold start is user-facing when
  the widget is tapped — but the expected result is "no measurable change".

If cold start ever did become the problem, `cat js/*.js > bundle.js` as a
Gradle pre-build task is about five lines. Don't add it speculatively.

### R3b — The full split

### Why plain scripts make this near-zero-risk

Top-level `let`/`const` in a classic script live in the shared global lexical
environment, so `const Bridge` declared in `store.js` is visible from
`voice.js`. Function declarations hoist. Nothing in the current script
references another section's `const` at *load* time — only inside function
bodies. So:

**The only ordering constraint is that `nav.js` loads last**, because it wires
DOM handlers and calls `boot()`. Everything else can go in any order.

That makes the split a cut-and-paste, and makes it verifiable: concatenate the
new files in load order, and the result should differ from lines 379–2129 of
the original only in whitespace.

Keep the tags where the `<script>` is today — after the markup, before
`</body>` — so DOM availability is unchanged.

### The file map

| File | Source lines | ~LOC | Contents |
|---|---|---|---|
| `js/store.js` | 379–398 | 20 | `Bridge` detection, `memory`, `Store.load/save` |
| `js/seed.js` | 400 | — | *(R2 — separate file, loaded first)* |
| `js/model.js` | 402–470 | 70 | `DEFAULTS`, `NOTIFY_MAX`, `SITUATIONS`, `INBOX`, `FLAGGED`, `FORM`, `STRUCTURAL`, `PROTECTED`, `isSituationLike`, `isActiveFilter`, `computed`, `tagsOf`, desk constants, `deskState`, `deskList`, `decayList`, `deskAgeLabel`, `decayLabel` |
| `js/boot.js` | 472–592 | 120 | `doc`/`S`/`recent`/`cooling`, `boot()`, `handleOpenRequest`, the five migrations, `persist()` |
| `js/util.js` | 594–628 | 35 | `$`, `active`, `buried`, `esc`, `uid`, `nid`, `now`, `fmt`, `sizeClass`, `toast`, `buzz`, `allTags` |
| `js/draw.js` | 630–742 | 113 | `matchesFilters`, `pool`, `requireCountWith`, `weightOf`, `inboxBadge`, `weightedIndex`, `pick`, `cast`, `recharge` |
| `js/card.js` | 744–869 | 126 | `card()`, `sourceHtml()`, the delegated click handler |
| `js/notes.js` | 871–986 | 116 | `addNoteToSpell`, `openAddNote`, `noteTime`, `noteHtml`, `openNotes` |
| `js/voice.js` | 988–1084, 1139–1168, + extraction below | 155 | `MEDIA`, `canRecord`, `onDisk`/`rec`/`player`, `clock`, `refreshMedia`, `audioMissing`, `dropMedia`, `sweepMedia`, `micBtn`, `startVoiceNote`, `paintRecorder`, `paintLevel`, `togglePlay`, `stopPlayback`, `setPlaying`, and a new `handleVoiceEvent(e)` |
| `js/native.js` | 1085–1137 | 30 | `window.onNative` — the inbound half of the bridge contract |
| `js/filters.js` | 1170–1288 | 119 | `tagFilterBits`, `filterSummary`, `libFilterLabel`, `renderFilterBar`, `openFilters` |
| `js/library.js` | 1290–1384 | 95 | `libTag`, `libGrave`, `SORTS`, `renderLibrary`, `openSpell`, `openTag`, `openSpellFromWidget` |
| `js/tags.js` | 1386–1496 | 111 | `tagEditMode`, `renderTags`, `manageTag` |
| `js/vault.js` | 1498–1612 | 115 | `renderVault` |
| `js/desk.js` | 1614–1641 | 28 | `renderDesk` |
| `js/editor.js` | 1643–1758 | 116 | `editSpell`, `triage` |
| `js/backup.js` | 1760–1802 | 43 | `headsetNow`, `backupInfo`, `openBackupFolder` |
| `js/reminders.js` | 1804–1966 | 163 | `TIME_RE`, `cleanTimes`, `notifyState`, `openRequest`, `freshDraw`, `notifySummary`, `nextFreeTime`, `saveTimes`, `openReminders` |
| `js/transfer.js` | 1968–2030 | 63 | `exportBook`, `importBook` — grows under R1 |
| `js/sheet.js` | 2032–2068 | 37 | `sheet`, `closeSheet` |
| `js/nav.js` | 2070–2129 | 60 | `go`, `renderAll`, `redrawCard`, `refreshQuiet`, `appBack`, top-level wiring, `boot()` — **loads last** |

Largest file ~163 lines, median ~110.

`native.js` is the one structural change rather than a pure cut. `onNative`
(`:1086–1137`) currently sits inside the voice section but handles `backup`,
`open` and `notify` too, and its voice branch (`:1113–1136`) is inside the same
function body — so it can't be split with a straight cut. Move the whole
function into `native.js` and replace the voice branch with a call to
`handleVoiceEvent(e)`, which is that branch lifted into `voice.js` verbatim.
That gives the inbound bridge contract one home, next to `store.js` which owns
the outbound one. With shared globals it needs no registration mechanism — it
calls the same functions it calls today.

This is the only place where the "concatenate and diff" check in *R3
verification* won't come back whitespace-clean. Review that one function by
hand.

### CSS

`css/app.css`, lines 8–305, one file. 298 lines is a reasonable size and the
existing `/* ---------- shell ---------- */` comments are already a good index.
Splitting it further can wait until it has a reason to.

Two fixes to make while moving it, both listed under R5.

### Cold start

21 sequential asset reads through `WebViewAssetLoader.shouldInterceptRequest`
instead of one. Each is a local `AssetManager` open — sub-millisecond — so the
expected impact is nothing. But cold start is user-facing here (tap the widget,
the app opens), so **measure it before and after**. If it ever matters, a
`cat js/*.js > bundle.js` step is trivially addable later; don't add it now.

### R3 verification

1. Concatenate in load order, diff against original lines 379–2129 — whitespace only.
2. Boot in a desktop browser over `file://`; console clean; cast, filter, edit,
   add a note, walk every tab.
3. Build and install; confirm the bridge still binds (the preview banner in the
   Vault should be absent) and voice notes still record.

---

## R4 — A verification loop *(built; do this first)*

**Status: implemented and delivered as `tools/smoke.mjs`.** Promoted above R1
on Roland's call, and the ordering turns out to be right for a reason beyond
preference — it's the thing that makes R1 and R3 safe to attempt.

There was none before. CI (`.github/workflows/build.yml`) runs `assembleDebug`
and uploads the artifact; that proves Gradle succeeded and nothing else. No
lint, no typecheck, no test, and 1,753 lines of JavaScript whose only check was
"the app didn't visibly break on my phone". The duplicate `@keyframes` in F5.1
had been live since voice notes shipped.

### What it does

The app is a web page, so **no APK is needed to test it.** `tools/smoke.mjs`
serves `app/src/main/assets/` over loopback and drives the real `index.html` in
headless Chromium with `Bridge === null` — which is precisely the preview mode
the app already supports and already has a banner for. 24 assertions, ~7
seconds end to end, most of that Chromium starting.

Coverage: boot and seed · cast (reveal, `revealed` class, `drawn` increment) ·
the useful / desk / source / note quick actions · inbox-strip on useful · every
tab rendering non-empty · filter narrowing and clearing · the empty-search
state · both branches of the `appBack` contract · `fmt`, `cleanTimes` and
`weightOf` (the pure functions reimplemented in Kotlin — see R6) · duplicate
`@keyframes` detection · and it fails on any console error or warning.

### First run, against unmodified `main`

```
23 passed, 1 failed
 FAIL  no duplicate @keyframes  → pulse
```

It found F5.1 on its own, without being told to look for it. Apply the
one-word rename and it goes green — verified.

### What to add next

1. **stylelint** for the CSS. The duplicate-keyframes check in the smoke test
   is a stand-in; a real linter catches the whole family and is one config file.
2. **`node --check`** on each `js/*.js` after R3 — free, catches a bad paste
   before it reaches a phone.
3. **A second CI job.** `npm ci && node tools/smoke.mjs` runs in well under a
   minute and never touches the Gradle path, so a red test doesn't block an
   APK you want anyway.
4. Real unit tests for the pure functions once R3 makes them importable
   without a browser.

### Two things it deliberately does not cover

Everything behind the bridge — persistence, voice recording, reminders,
backups, the widget — is invisible here, because `Bridge` is null. Covering it
means either a fake bridge injected before boot (cheap, and would let the
R1 recovery paths be tested properly) or an instrumented Android test (real,
and much more work). **The fake bridge is worth building as part of R1**, since
the recovery logic is exactly the code that must not be wrong and cannot
currently be exercised at all.

The second gap is visual. Nothing here would catch a layout that broke; it
only catches a page that errored. Screenshot comparison is possible with the
same tooling if that ever matters.

---

## R5 — Code hygiene

Ordered by whether they're wrong or merely untidy.

### F5.1 — Duplicate `@keyframes pulse` (live bug)

`index.html:90` and `index.html:170`.

```css
/* :90  — intended for the sigil */
@keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}
/* :170 — intended for the recording dot */
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.82)}}
```

A later `@keyframes` of the same name replaces the earlier one entirely. So
`.pulse` (`:87`), used by the sigil's two inner circles (`:325–326`), animates
with the recorder's scale-and-fade instead of the intended opacity breath.

**Fix:** rename the second to `pulse-dot` and update `.vdot.live` (`:169`).

### F5.2 — The four copies of the tag strip

`index.html:753–754` (inside `card()`), `:821–822` (useful handler),
`:836–837` (flag handler), and the near-identical `:1741` in `triage()`.

Extract `tagsHtml(s)` into `card.js` and call it from all four. This is the
single worst uniqueness problem for exact-match editing in the file.

### F5.3 — Two rendering strategies for the same state change

`redrawCard()` (`:2096–2102`) replaces `outerHTML`. The `useful` and `flag`
handlers (`:810–844`) hand-patch individual nodes instead, to avoid restarting
the card's entrance animation.

Both are reasonable; having both is the problem, because a change to card
markup has to be made in two places and they have already drifted — the useful
handler removes the `.badge.untested` element and rebuilds the tag strip, the
flag handler does the same but in a different order and doesn't update the
`useful` count node.

**Fix:** one `patchCard(s, {animate:false})` that replaces `outerHTML` and then
strips `.rise`, used everywhere. Verify the pin animation (`.act.pinned`,
`:250`) still lands — that one deliberately runs on the button, not the card,
so it should survive.

### F5.4 — The reminders sheet is identified by its title text

`index.html:1109–1110`

```js
const open = document.querySelector('.sheet .top .eyebrow');
if(open && open.textContent === 'Reminders') openReminders(true);
```

Rename the sheet's title copy and the notification-permission refresh silently
stops working. Give `sheet()` a `data-sheet="reminders"` attribute and match on
that.

While there: `sheet._onClose` as a static property on a function, and the
inline `onclick="closeSheet()"` at `:2055` (the only inline handler in the
file, requiring the `window.closeSheet` export at `:2068`), are both worth
tidying when `sheet.js` gets its own file.

### F5.5 — `'inbox'` as a literal, ten times

`INBOX` is declared at `:408` and used four times. The bare string `'inbox'`
appears at `:570`, `:571`, `:812`, `:813`, `:831`, `:832`, `:1647`, `:2013`.
Same story for `'graveyard'` (six literals, no constant at all) and
`'active'`.

Mechanical, but it's the kind of thing that makes a rename fail halfway.

### F5.6 — 55 inline `style="…"` attributes in template literals

The design system in `:root` (`:9–17`) is only half-honoured. Things like
`style="${on?'border-color:var(--brass);':''}"` (`:1215`),
`style="padding:6px 12px"` (`:353`), `style="flex:1;min-width:0"` (`:1878`)
bypass the stylesheet, so restyling means grepping template literals.

The `on`/`off` state toggles are the ones worth converting first — they're the
only ones carrying real meaning, and they'd become `.tagbtn.picked` /
`.factitem .nm.required` etc.

### F5.7 — `esc()` doesn't escape `'`, and one selector uses raw input

`esc` (`:598`) covers `& < > "`. Every attribute in the file is
double-quoted, so that's safe. But `:1699` builds a selector from the
unescaped tag:

```js
if(!$(`#eTags [data-t="${t}"]`)){ … }
```

Tag input is normalised with `.trim().toLowerCase().replace(/\s+/g,'-')`,
which leaves `"` intact. A tag containing a quote throws `SyntaxError` from
`querySelector` and the keydown handler dies. Self-inflicted only, but a
one-character fix (`CSS.escape`, or reject the character on input).

### F5.8 — Kotlin: a no-op with a misleading comment

`MainActivity.kt:309–310`

```kotlin
// Flush WebView's own caches; our data is already on disk after every edit.
web.evaluateJavascript("void 0", null)
```

Evaluating `void 0` flushes nothing. Delete both lines, or replace with the
thing that was meant (`web.saveState`? `WebStorage.getInstance().flush()`?).
As written it's a comment asserting something untrue, which is worse than no
comment.

### F5.9 — Kotlin: `save()` does heavy work on the caller's thread

`SpellbookBridge.save()` (`:43–61`) runs, synchronously, on the binder thread
that the JavaScript caller is blocked on:

write temp → rename → `rollBackup` (a second full write) → `offsite` →
`SpellWidget.refresh` → `Reminders.syncFrom`.

Most days `offsite` is gated and cheap. But on the first save of a day with a
backup folder set, `Backups.writeNow` runs inline: a SAF `createFile`, a full
JSON write, and a walk of the media directory copying any new recordings —
across a `DocumentsProvider` that may be a cloud mount. `persist()` is called
on every card action, so the user experiences this as a random tap that hangs.

**Fix:** move `offsite()` off the calling thread (a single-thread executor is
enough; it must not run concurrently with itself) and let `save()` return as
soon as the book is on disk. The result already comes back asynchronously via
`emit()` for the folder-picker case, so the channel exists.

`backupNow()` should stay synchronous — the page waits and reports, which is
the documented intent.

### F5.10 — Boot writes the book up to six times

`boot()` (`:477–502`) calls `Store.save()` once for the seed, then each of the
five migrations may call `persist()`. Every one of those runs the full
`save()` pipeline in F5.9. On a first run that's six passes.

**Fix:** run migrations against an in-memory doc, track a dirty flag, and
`persist()` once at the end.

### F5.11 — Minor

- `card()` emits `animation-delay:undefinedms` when called with
  `{delay:undefined}` from `openSpell` (`:750`, `:1355`). Invalid, ignored,
  harmless — but it's a smell that `delay:undefined` means "no animation".
- `sourceHtml()` (`:794`) puts `<dt>`/`<dd>` inside a bare `<div>` with no
  `<dl>`. Works everywhere; invalid.
- `#toast` is declared as two separate rule blocks (`:280` and `:284`) with
  `#toast.high` between them.
- The `recent` no-repeat window (`:473`) is in-memory only and resets every
  launch — already noted in the features doc under *Weighted draw*.

---

## R6 — Cross-boundary duplication register

Eight things exist in both halves with nothing keeping them in step. This isn't
a bug list; it's the register that should live in `docs/bridge.md` so the next
change to either side knows what it has to mirror.

| # | Duplicated | JavaScript | Kotlin | Collapsible? |
|---|---|---|---|---|
| 1 | `**bold**` / `*italic*` / `==highlight==` parser | `fmt()` `:603–608` | `SpellWidget.MARKUP` + `styled()` `:142–181` | No — different render targets |
| 2 | Weighted pick | `weightOf`, `weightedIndex` `:663–681` | `Book.weighted` + inline weighting `:266–309` | No — must stay deterministic in Kotlin |
| 3 | Tag names `inbox` / `flagged` | `:408–409` | `Book.INBOX` / `FLAGGED` `:237–238` | No |
| 4 | Default draw weights (3 / 1) | `DEFAULTS` `:403` | `Book.spellOfTheDay` fallbacks `:246–247` | Partly — Kotlin could read `DEFAULTS` if it were in the file |
| 5 | Reminder cap of 3 | `NOTIFY_MAX` `:405` | `Reminders.MAX` `:37` | **Yes** — `notifyState()` already returns `max` and the page ignores it |
| 6 | Default reminder text | `DEFAULTS.notifyText` `:404` | `Reminders.DEFAULT_TEXT` `:39` | **Yes** — `notifyState()` already returns `defaultText` and the page ignores it |
| 7 | Colour palette | `:root` `:9–17` | `res/values/colors.xml` (whose comment says "keep these in step by hand") | No — different rendering systems |
| 8 | Media filename shape | trusted implicitly | `VoiceRecorder.SAFE` `:347` | No — the Kotlin check is the security boundary and must stay |

\#5 and \#6 are free wins: `SpellbookBridge.notifyState()` (`:197–204`)
already sends both values across, and `openReminders` (`:1869–1966`) uses its
own constants instead. Consume what's already there.

For the rest, the register plus a comment on each side pointing at its twin is
the realistic answer.

**The bridge contract itself**, for `docs/bridge.md`:

- **Out (JS → Kotlin), 18 `@JavascriptInterface` methods:** `load`, `save`,
  `export`, `startVoiceNote`, `stopVoiceNote`, `cancelVoiceNote`,
  `bluetoothMicAvailable`, `mediaList`, `deleteMedia`, `pruneMedia`,
  `notifyState`, `requestNotifyPermission`, `openNotificationSettings`,
  `openRequest`, `backupInfo`, `pickBackupFolder`, `clearBackupFolder`,
  `backupNow`. R1 adds `bookState`, `snapshots`, `readSnapshot`.
- **In (Kotlin → JS), one channel:** `window.onNative(jsonString)`, with
  `kind` ∈ `backup` | `open` | `notify` | `voice`, and for `voice` a `type` ∈
  `routing` | `fellBack` | `started` | `level` | `route` | `saved` |
  `tooShort` | `cancelled` | `denied` | `error`.

Document the payload shape of each and the guarantee that `Bridge` may be
`null` (preview mode) for every one of them.

---

## R7 — Documentation restructure

No rewriting. Moving paragraphs into files whose names say what they are, plus
three files that don't exist.

### The diagnosis

`spellbook-features.md` (508 lines) does four jobs:

- **Reference** — *Principles* and *The vocabulary* (`:11–35`). The most
  durable writing in the repo, filed above a changelog.
- **Shipped** (`:43–83`) — 40 flat chronological entries where later ones
  contradict earlier ones. `:65` describes `needs-review`; `:74` renames it to
  `flagged`. `:57`/`:67` describe two incompatible filter models. Reading top
  to bottom is currently the only way to learn what the app does today. That's
  a changelog doing a reference's job.
- **Specs** (`:125–497`) — architecture decision records in all but name.
- **Queue** (`:91–121`) — a roadmap.

`README.md` has drifted from build/install instructions into feature
explanation (the widget, reminders and backup-folder sections), duplicating the
features doc.

Missing entirely: any agent-facing file, any single description of the bridge
contract, any schema for `spellbook.json`.

### Target tree

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

Each ADR is lifted almost verbatim from the corresponding spec section — the
"rejected because" paragraphs are already written and are the best content
here. Give each a *Status* line so a superseded decision is visible as such,
which is the thing the flat Shipped list can't express.

### `CLAUDE.md` — the invariants to state

This is the cheapest file to write and probably the highest-leverage. It should
say, at minimum:

- Where the code is: one HTML shell + `js/*.js` + `css/app.css` in
  `app/src/main/assets/`; six Kotlin files in `app/src/main/java/com/spellbook/`.
- **A change must work in two environments**: inside the WebView (bridge
  present) and in a plain `file://` desktop preview (`Bridge === null`, no
  storage, no recording, no reminders). Anything that assumes the bridge must
  be guarded — that's why `canRecord()` and `if(Bridge)` exist.
- **Eight things are implemented twice** across the language boundary — see
  `docs/bridge.md`. Changing one without the other is the most likely way to
  break this app.
- **`seed.js` is generated.** Never hand-edit.
- **There is no test loop** (until R4). "It compiles" is not evidence. State
  what manual check a change needs.
- The migration convention: one-shot, guarded, commented with why, and
  `persist()` only if something changed.
- The three principles that are load-bearing rather than aesthetic: derived
  properties are never stored; the JSON file is the truth; nothing leaves the
  device unless asked.

---

## Sequencing

```
R4  verification      ── DONE. tools/smoke.mjs, 24 checks, ~7s
R5a F5.1 keyframes    ── one-word fix; turns the suite green
R1  recover           ── highest value; build the fake bridge here so it's testable
R2  seed out          ── needs D1
R3a partial split     ── the eight cold sections; ~50k → ~17k tokens
R6  duplication doc   ── independent, pairs with R7
R7  docs              ── independent
R5  rest of hygiene   ── folds into R3a where the files overlap
R3b full split        ── only if a remaining section starts feeling too big
```

Three ordering notes worth taking seriously:

- **R4 before everything, which is now settled.** A smoke test written against
  the current file is what proves a later change moved nothing. Written
  afterwards it only proves the new output is self-consistent with itself.
- **Build the fake bridge during R1, not after.** The recovery paths are the
  code that most needs to be right and are currently the code that cannot be
  exercised at all. A stub `window.Android` injected before boot — with a
  scriptable `load()` that can return valid JSON, garbage, or throw — turns
  every branch of F1.1/F1.2 into a test that runs in a second.
- **Don't combine a split with a module-system change (D2b).** If both land in
  one pass and something breaks, you won't know which did it.

---

## Environment notes

**The Linux workspace on this device does not start.** `device_bash` returns
*"the isolated Linux environment on this device failed to start"*, so all
repo access this session went through stage/commit rather than a shell.
The device is Windows (`win32`, desktop app 1.37937.3). That workspace is a
WSL2-backed sandbox, so the usual causes are WSL not installed or not enabled,
virtualisation off in firmware, or a broken/updating WSL kernel. Worth checking
`wsl --status` and `wsl --update` in an admin PowerShell — if it comes back,
in-place editing and running scripts against the repo become possible without
copying files back and forth.

**Local builds — three separate options, only one of which needs WSL.**

1. *Cloud container* (available now, no WSL). Android SDK command-line tools
   plus JDK 17 can be installed here and `gradle assembleDebug` run against
   the staged repo, with the APK committed straight back into the folder.
   Faster than the GitHub Actions round trip. Costs a few minutes of SDK
   download per session, because the container is ephemeral — nothing persists
   between sessions. Untested so far; the container's network allowlist would
   need to reach `dl.google.com` and `maven.google.com`.
2. *Android Studio or a plain Gradle install on Windows* (no WSL, no me). This
   is by far the fastest inner loop for hand-editing, and the honest answer to
   "so I don't have to go through GitHub Actions every time". CI then becomes
   what it should be — the check that it builds on a clean machine, not the
   only way to get an APK.
3. *The WSL workspace, once it starts.* Would need the SDK installed inside
   that VM, and its network follows this session's egress settings, which may
   be narrower than the container's. The least certain of the three.

**And the point that matters most for the current priority:** none of this is
needed to test the app. R4 runs against `app/src/main/assets/` in headless
Chromium and never builds an APK. The build question and the testing question
turn out to be independent.

---

## The repo is public — what that actually changes

Roland's read is right on both counts and the plan is corrected accordingly.

**Moving the seed out does not remove it from history.** `git log -p` still
carries every version of line 400. So R2 is a *forward* fix — it stops the
next 148 spells from being published and it fixes the token cost, which was
always the stronger reason. It is not a privacy remediation on its own.

The three actual options, in ascending order of effort:

- **Make the repo private.** One click, instant, reversible, free. Removes it
  from GitHub search and public view immediately. Caveats: any existing forks
  or clones survive, and cached views may linger briefly. Actions minutes go
  from unlimited to the free tier's 2,000/month — the README already notes
  builds take three to five minutes, so that's roughly 400 builds a month.
  Not a constraint.
- **Collapse the history.** `git checkout --orphan` → one commit → force push.
  Removes the seed from the repo entirely, and costs the 19-commit history —
  which, given how good the commit messages are, is a real loss and the reason
  I'd only do this in combination with going private rather than instead of it.
- **Leave it.** Defensible. The content is personal but not sensitive in the
  credential sense, and the realistic exposure is scraping rather than attack.

**Decided: stays public, and the history gets purged.** See below.

---

## Purging the seed from history

**D4 answered: keep the repo public, remove the spell data from git.** Now that
`index.html` no longer contains the seed, the only copies left are historical.

I can't run these — no shell on the device this session, and a force-push needs
your credentials — so they're written out to run yourself. **Take a backup
first:** `git clone --mirror` the repo to somewhere safe before anything below.

### Step 0 — find every copy, not just the obvious one

Before rewriting, establish what actually needs to go. The seed line is the
known one; these check for the others:

```bash
# Which commits ever touched a seed line, and what shape was it in?
git log --all --oneline -S'const SEED' -- app/src/main/assets/index.html

# Was a built APK or zip ever committed? Both embed the seed.
# (.gitignore covers them now, but it was added in commit 4 of 20.)
git log --all --diff-filter=A --name-only --format= | sort -u | grep -iE '\.(apk|zip)$'

# Any spell text that leaked into other files?
git log --all -S'sp_9e539136' --oneline        # a real id from the old seed

# The five biggest blobs in history — a stray APK shows up here immediately.
git rev-list --objects --all \
  | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
  | awk '$1=="blob"' | sort -k3 -n -r | head -5
```

### Step 1 — rewrite, keeping the commit history

`git-filter-repo` is the maintained tool (`git filter-branch` is deprecated and
much slower; the BFG is fine but less precise). It preserves your 19 commit
messages, which is why I'd use it over an orphan commit.

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
commits — the line is anchored on `const SEED = [{"id"` and ends at `];`, which
matches every version I can see in the current file, but I can't read history
from here.

Then verify **before** pushing:

```bash
git log --all -S'sp_9e539136' --oneline     # must print nothing
git grep -I 'const SEED = \[{' $(git rev-list --all) | head   # must print nothing
```

### Step 2 — get it off GitHub for real

This is the part that gets skipped and matters most. A force-push does **not**
remove the old objects from GitHub: unreachable commits stay retrievable by SHA
for a long time, and cached diff views can outlive them.

Two ways to close that, in order of certainty:

- **Delete the repository and recreate it** (Settings → Danger Zone), then push
  the rewritten history to the fresh remote. Guarantees no dangling objects.
  Costs the Actions run history, and any stars/issues/watchers — check what
  you'd lose first. For a personal repo this is usually nothing.
- **Force-push, then ask GitHub Support to garbage-collect** the repository and
  purge cached views. They do this on request; it's just slower and you're
  trusting a process rather than a deletion.

Either way: **check for forks first** (`Insights → Forks`). A fork keeps its own
copy and GitHub will not rewrite someone else's repository. If there are any,
deletion of your copy doesn't reach them.

```bash
git remote set-url origin https://github.com/rweilbacher/spellbook.git
git push --force --all && git push --force --tags
```

Afterwards, `git clone` fresh somewhere and grep it, rather than trusting the
local rewrite. And note your working copy at
`C:\Users\Roland\Google Drive\Projects\spellbook` will need re-cloning or a
hard reset, since every commit SHA changes.

### Step 3 — what stays

`spellbook-features.md` quotes a handful of spell-like lines as examples
(*watch your feet*, *what's the vulnerable thing?*, the invented dark-spell
examples). Those are illustrations in a design document, not the book. Leaving
them is fine unless you'd rather they weren't there.

**Worth knowing:** none of this is urgent, and none of it blocks the remaining
work. The forward leak is already closed — the seed in the repo today is
synthetic.

**The keystore does not matter, and the earlier report over-weighted it.**
Correct on the substance: it signs a sideloaded personal APK. It is not a Play
upload key, there's no Digital Asset Links or app-links binding to its
fingerprint, and no `signature`-level permission shared with another app. The
worst an attacker does with it is sign an APK that Android would accept as an
update to `com.spellbook` — which still requires getting that APK onto the
phone, at which point the signature is not the weak link. The README's own
reasoning ("Not a secret: it only signs this app for this phone") is sound and
should stay. The only thing that would change this is publishing to Play, at
which point a real upload key is needed regardless.

---

## Open decisions

**D1 — What ships in `seed.js`?** Full (relocated only) · empty and gitignored
· dated and regenerated from an export. Now that the repo's visibility is a
separate lever, this is mostly a question about whether a fresh install should
be usable before you Import.

**D2 — Plain script tags or ES modules?** Plain: zero risk, keeps `file://`
preview, keeps the global namespace. Modules: real encapsulation and explicit
dependency edges, needs a one-line static server for desktop preview.
Recommendation: plain now, modules as a separate later decision.

**D3 — Partial split (R3a) or full (R3b)?** Recommendation: partial. Eight
files, 85% of the token win, and the remainder is exactly the hot surface most
tasks need anyway.

**D4 — Repo visibility.** Private / public / private plus a history collapse.
Independent of everything else and takes one click.

**D5 — Scope and pace.** R5a (the keyframes fix) is a one-word change that
turns the suite green and could land immediately. R1 is independent of the
structural work and could follow on its own. The split can wait as long as you
like now that there's a test to make it safe.
