# Refactor plan

Working document for the implementer. Opened 2026-08-28; revised as work lands.

Everything on the original list is now done. What's left is listed at the
bottom, and it is mostly *run it on a phone*. The reasoning that used to live
in this file has moved into the repo proper — `docs/` and `CLAUDE.md` — which
was item R7 and is itself done.

---

## Where this stands

| | Item | Status |
|---|---|---|
| R4 | Verification loop — `tools/smoke.mjs` | **Done** · 94 checks green |
| R5a | Duplicate `@keyframes pulse` (F5.1) | **Done** |
| R2 | Synthetic seed, moved to its own file | **Done** |
| R3a | Partial split — 8 cold files extracted | **Done** |
| R1 | Make the book recoverable (F1.0 – F1.6) | **Done** · not yet run on a phone |
| R6 | Cross-boundary duplication register | **Done** · `docs/bridge.md`; #5 and #6 collapsed |
| R7 | Documentation restructure | **Done** |
| R5 | The rest of the hygiene (F5.2 – F5.11) | **Done** |
| R3b | The rest of the split | Optional — only if a file starts to hurt |
| — | Purge the old seed from git history | Ready to run; commands at the end |

### Measured

| | Before the structural pass | After it | Now |
|---|---|---|---|
| `index.html` | 2,133 lines · 169,016 chars | 1,355 · 64,203 | 1,658 · 78,251 |
| Seed | 148 real spells · one line | 46 synthetic · one per line | unchanged |
| Files in `assets/` | 1 | 9 | 9 |
| Automated checks | 0 | 37 | **94** |
| Docs | 2 files, one doing four jobs | same | 13, each doing one |

`index.html` grew by 300 lines in this pass and that is the right trade: the
recovery screen, the restore path and `patchCard` are new behaviour, and about
a third of the growth is comments explaining why the boot path is shaped the
way it is. It is still a third of what it was.

---

## Decisions — all answered

**D1 · What ships as the seed?** → **Synthetic, representative data**, committed
normally. Removes the privacy problem at the source, makes the staleness problem
structurally impossible, keeps a fresh install immediately usable, and gives the
test suite a fixture that doesn't change under it.

**D2 · Plain script tags or ES modules?** → **Plain tags.** Files talk to each
other through the shared global namespace, exactly as the one big file did. Zero
risk, no build step, and `index.html` still opens directly in a browser.

**D3 · Partial split or full?** → **Partial (R3a).** Eight cold files, 85% of
the token win.

**D4 · Repo visibility?** → **Stays public**, with the old seed purged from
history. Procedure at the end.

**D5 · Scope and pace?** → Structural pass first, then R1, then the writing.
All landed.

---

## What landed in the second pass

### R1 · The book is recoverable

Five findings chained into one failure: an unreadable book was indistinguishable
from no book, so boot seeded over it, and import could not put the counts back.
The whole chain is closed.

- **F1.0 · The fake bridge, first.** `tools/smoke.mjs` now installs a
  scriptable `window.Android` before boot: `bookState()` can answer `missing`,
  `ok`, `unreadable` or throw; `load()` can hand back a real book, truncated
  JSON, or nothing; every `save()` is recorded rather than written. That makes
  each branch below a test that runs in a second — including the assertion that
  matters most, **`save()` was never called**.
- **F1.1 · `Store.load()` answers with a state**, not `null`: `missing` · `ok` ·
  `corrupt` · `unreadable`. Kotlin gained `bookState()`, which is the only way
  to tell an I/O failure from a first run. Shells older than this one behave
  exactly as they did.
- **F1.2 · `boot()` seeds only on `missing`.** Anything else renders a recovery
  screen and writes nothing at all. A parsed book with zero spells counts as
  corrupt, since burying moves a spell's state and never removes one.
- **F1.3 · Restore and merge are two different things now.** Restore replaces
  the book wholesale and is the only path that can bring a count back; it keeps
  the current book as a `pre-restore-` copy first. Merge takes
  `Math.max(stored, incoming)` on counters and never resurrects a buried spell.
- **F1.4 · Settings come back with a restore**, through the same
  `adoptSettings()` path boot uses — so `notifyTimes`, the wording, the weights
  and `tagKindOverrides` survive.
- **F1.5 · `files/backups/` is reachable at last.** `snapshots()` and
  `readSnapshot()` on the bridge, **Vault → Keeping → Earlier versions** in the
  app, and the same list on the recovery screen, which is the case it exists
  for. Names are validated against a strict pattern before the filesystem is
  touched.
- **F1.6 · `SCHEMA = 2`**, stamped on every `persist()`; migrations run forward
  from the version the file claims, with their per-field guards kept as
  belt-and-braces.

All four items on the original R1 verification list are now assertions in the
suite, plus eleven more around them. What is **not** verified: any of it on a
real device. See *What's left*.

### R5 · The hygiene

- **F5.2** One `tagsHtml(s)` replaces four copies of the tag strip.
- **F5.3** One `patchCard(s, el)` replaces two drifting redraw strategies, and
  carries over what belongs to the element rather than the spell — the entrance
  animation doesn't replay, an open source panel stays open, the badge keeps
  its kind.
- **F5.4** Sheets have a `name` alongside their title, and `window.onNative`
  matches `data-sheet="reminders"` rather than the words on screen.
  `sheet._onClose` became a module-level `sheetOnClose`, and the one inline
  `onclick` in the codebase went with it.
- **F5.5** `INBOX`, `ACTIVE` and `GRAVEYARD` are constants everywhere.
- **F5.6** The state-carrying inline styles became `.tagbtn.picked` and
  `.factitem .nm.required` / `.never`. The remaining ~39 are layout nudges.
- **F5.7** `esc()` covers `'` too, and the one selector built from raw tag input
  goes through `CSS.escape`.
- **F5.8** The `void 0` no-op with the untrue comment is gone.
- **F5.9** `offsite()` runs on a single-thread executor and `save()` returns
  once the book is on disk. `backupNow()` stays synchronous and shares a lock
  with it, so that folder only ever has one writer.
- **F5.10** Boot writes once instead of up to six times.
- **F5.11** No more `animation-delay:undefinedms`; `dt`/`dd` sit inside a `dl`;
  `#toast` is one rule block again.

### R6 · The register

`docs/bridge.md` carries the full contract in both directions and the eight-row
duplication register. **#5 and #6 are collapsed:** `notifyState()` had been
sending the reminder cap and the default wording across all along and the page
ignored them in favour of its own constants. Kotlin now holds the only copy of
each, and there's a test that proves the page reads what it's told.

### R7 · The writing

`spellbook-features.md` was four documents in a trench coat. Nothing was
rewritten; the paragraphs moved:

```
README.md              build, install, keystore, where data lives
CLAUDE.md              repo map, invariants, how to verify a change
CHANGELOG.md           ← "Shipped", plus this pass
docs/design.md         ← Principles + The vocabulary
docs/architecture.md   the two halves, boot, storage layout, rendering
docs/bridge.md         the full contract + the duplication register
docs/data-format.md    the schema, versioning, the migration convention
docs/roadmap.md        ← Queue + the specs not yet built + the hygiene backlog
docs/decisions/        seven ADRs, each with a Status line
```

`spellbook-features.md` is now a one-screen signpost saying where each part
went. It can be deleted once you've seen it.

### R4 · The suite, extended

37 checks → 94. New: the eight JS files and the inline block are parsed before a
browser is started; the fake-bridge scenarios above; the reminder cap and
wording coming from the bridge; and `patchCard` keeping what it should.

Two robustness fixes: `/favicon.ico` is answered with a 204 (some Chromium
builds ask for it, and the 404 failed the console-hygiene check for a reason
that had nothing to do with the app), and `SMOKE_CHROMIUM` lets a machine with
Chromium already on disk skip `npx playwright install`.

`.github/workflows/test.yml` runs it on every push and pull request, separately
from the APK build, so a red test can't stop you getting an APK you wanted.

---

## What's left

### 1 · Run it on a phone

Nothing in either pass has been on a device. The suite covers the logic; it
cannot cover the WebView.

- **Does `WebViewAssetLoader` serve the new subdirectories?**
  `AssetsPathHandler` should handle the whole `/assets/` tree, but this is the
  first build since the split. Open the app: if the stylesheet and the eight
  scripts load, this is answered.
- **Does the Kotlin compile?** Four new bridge methods, an executor and a lock,
  none of it through a compiler — this container can't reach `dl.google.com` or
  `maven.google.com` (both 403 through its egress proxy), so there is no Android
  SDK here. The Actions build is the first check.
- **The recovery screen, for real.** Corrupt `spellbook.json` over adb, open the
  app, confirm the recovery screen appears and the file is **byte-identical**
  afterwards. Then restore from an earlier version and confirm the counts come
  back.
- **Cold start.** Eight asset reads instead of one. Against WebView init this
  should be noise, but it's user-facing when the widget is tapped, so measure it
  once.

### 2 · Two things the suite still can't see

- **Anything visual.** It catches a page that errored, not a layout that broke.
  Screenshot comparison is possible with the same tooling if that ever matters.
- **The Kotlin twins** of `fmt`, `weightOf` and `cleanTimes`. The JS side is
  tested; the widget's reimplementations aren't. See the register.

### 3 · Still worth adding

- **stylelint** over `css/app.css`. The duplicate-`@keyframes` assertion is a
  stand-in for a real linter and only catches the one thing it was written for.
- **R3b**, the rest of the split, if a section starts to feel too big. `vault`
  and `card` are the next candidates; the one piece that isn't a straight cut is
  `window.onNative`. Details in `docs/roadmap.md`.

---

## Reference

### What not to touch

Moved to `CLAUDE.md`, where it belongs: the Kotlin, the absence of a build step,
JSON as truth, derived-not-stored, the migration convention, performance, and
the prose.

### Environment notes

**The Linux workspace on this device does not start.** `device_bash` returns
*"the isolated Linux environment on this device failed to start"*, so all repo
access goes through stage/commit rather than a shell. The device is Windows and
that workspace is WSL2-backed, so the usual causes are WSL not installed or not
enabled, virtualisation off in firmware, or a broken kernel. `wsl --status` and
`wsl --update` in an admin PowerShell are the things to check.

**A second wrinkle, new this session:** some files in the Google Drive folder
report as hardlinked (`nlink > 1`) and refuse to stage — `index.html`,
`README.md`, `spellbook-features.md`, `app/build.gradle.kts`,
`AndroidManifest.xml`. Files written back by a previous session stage fine, so
this looks like Drive's own deduplication of files that arrived by checkout. The
way round it: clone from GitHub inside the cloud container, and verify
byte-for-byte that the clone matches the local copies before touching anything.
It did — every file, on content or on size.

**Local builds — three options, only one needing WSL.**

1. *Cloud container.* **Ruled out for now:** `dl.google.com` and
   `maven.google.com` are both 403 through the container's egress proxy, so
   there's no way to install the SDK or resolve the Gradle plugins.
2. *Android Studio or plain Gradle on Windows* (no WSL). By far the fastest
   inner loop, and the real answer to not wanting the Actions round trip. CI
   then becomes what it should be — the clean-machine check, not the only way to
   get an APK.
3. *The WSL workspace, once it starts.* Needs the SDK inside that VM.

**None of this is needed to test.** `node tools/smoke.mjs` runs against
`app/src/main/assets/` in headless Chromium and never builds an APK.

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
but less precise). It preserves your commit messages, which is why it beats an
orphan commit.

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
  Costs the Actions run history and any stars/issues/watchers — for a personal
  repo that's usually nothing.
- **Force-push, then ask GitHub Support to garbage-collect** the repository and
  purge cached views. Slower, and you're trusting a process rather than a
  deletion.

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

**Step 3 — what stays.** The docs quote a handful of spell-like lines as
examples (*watch your feet*, *what's the vulnerable thing?*, the invented
dark-spell examples). Those are illustrations in a design document, not the
book. Fine to leave unless you'd rather they weren't there.
