# The data format

One JSON file, `files/spellbook.json`. It is the truth: the widget reads it
directly, `Reminders` reads it at boot without the WebView, and an export is a
copy of it.

## The document

```json
{
  "version": 3,
  "exportedAt": "2026-08-28T09:12:44.031Z",
  "inboxSeeded": true,
  "settings": { },
  "tags": [ ],
  "spells": [ ]
}
```

| Field | Meaning |
|---|---|
| `version` | the schema this file was last written by. See below. |
| `exportedAt` | when it was last written. Not used to decide anything. |
| `inboxSeeded` | the one doc-level migration flag: the retroactive inbox pass has run. |
| `settings` | this phone's preferences. Restored with the book, ignored by a merge. |
| `tags` | the tag vocabulary. Authored content, so it travels with the book. |
| `spells` | the book. |

## The tag vocabulary

`tags` is every tag the book knows, sorted. It is stored rather than counted
from the spells — the one deliberate exception to "derived properties are
never stored", and `decisions/0008` is why. A tag with no members has to keep
existing, because the sticky filters point at names, and a name that stopped
rendering could not be switched off.

- `allTags()` reads it and attaches a live count. The **count** is still
  derived; only the list is stored.
- `STRUCTURAL` — `question`, `untagged`, `useful` — is never in it. Those are
  computed at render time; `allTags()` seeds them in at 0 separately, so a
  filter set on `untagged` survives the inbox emptying out.
- `syncTagVocabulary()` keeps it a superset of what's in use: every tag any
  spell wears (buried included), plus anything `include` / `require` /
  `exclude` or `tagKindOverrides` still names. It is an invariant, not a
  one-shot — it runs at every boot and after a merge, and is a no-op once
  satisfied.
- Deleting a tag in the tag manager is the only thing that removes an entry.
  It clears the tag from all four of those places at once, or the next sync
  would put it straight back.
- A **restore** brings the vocabulary with it, empty categories included. A
  **merge** learns only the tags arriving on the spells.

## A spell

```json
{
  "id": "sp_9e539136",
  "text": "Watch your feet.",
  "tags": ["arriving", "inbox"],
  "useful": 0,
  "drawn": 3,
  "lastDrawn": "2026-08-27T18:02:10.884Z",
  "state": "active",
  "desked": null,
  "notes": [],
  "createdAt": "2026-01-12T09:00:00+00:00",
  "updatedAt": "2026-02-03T09:00:00+00:00",
  "source": { "origin": "manual", "note": null, "file": null,
              "line": null, "url": null, "capturedAt": "2026-02-23" }
}
```

- **`tags`** are authored only. `question`, `untagged` and `useful` are computed
  at render time and must never be stored — `STRUCTURAL` is the list, and both
  import paths strip them on the way in.
- **`state`** is `active` or `graveyard`. Nothing removes a spell from the book;
  burying moves it. That is why a book with zero spells is a corruption signal.
- **`desked`** is a single timestamp or `null`. Desk freshness and decay are
  computed from it, so nothing needs a cleanup job.
- **`notes`** is a thread of `{id, type, text|file, createdAt}`. `type` is
  `text` or `voice`; a voice note carries `file` and `duration`, and its audio
  lives in `files/media/`, never in this file.
- **`source.origin`** is `manual`, `obsidian` or `import`.

## Settings

`drawCount` · `include` / `require` / `exclude` (the sticky filters) ·
`noRepeat` · `sort` · `inboxWeight` · `flaggedWeight` · `tagKindOverrides` ·
`btMic` · `notifyTimes` · `notifyText`.

`DEFAULTS` in `index.html` holds every default except `notifyText`, which is
Kotlin's (`Reminders.DEFAULT_TEXT`, read across the bridge — see
`bridge.md`, register entry 6).

`adoptSettings()` is the one door in: `Object.assign({}, DEFAULTS, incoming)`,
then the array and type guards, then `cleanTimes()`. Boot and restore both use
it, so a file from anywhere gets the same treatment.

## Versioning and migrations

`SCHEMA` in `index.html` is the current version. `persist()` stamps it on every
write. `runMigrations()` reads the version the file claims and runs forward
from there.

| version | what it means |
|---|---|
| 1 | everything up to and including the notes field. The stamp sat here through five migrations, which is why each of them is also guarded by the field it fixes. |
| 2 | the stamp starts moving. |
| 3 | `tags`, the stored vocabulary. |

**The convention for a new migration**, unchanged, because it works:

- One-shot and idempotent — guarded by the presence or absence of the thing it
  fixes, not by a flag, unless there is no field to look at (`inboxSeeded` is
  the one exception, and it exists because a manually-removed `inbox` tag must
  not come back).
- Commented with *why*, not what.
- Returns whether it changed anything. `boot()` collects those and does a single
  `persist()` for the whole of boot.
- Added to `runMigrations()` under a `version` gate, with `SCHEMA` bumped in the
  same commit.

The five that have shipped: legacy flag tags (`review` / `needs-review` →
`flagged`), the filter schema split, the desk field, the retroactive inbox pass,
and the notes array.

`syncTagVocabulary()` is the sixth and the one that breaks the convention: it
carries no version gate. The other five fix a field once; this one states an
invariant that has to hold on every boot, and `doc.tags` is load-bearing enough
— every tag list in the app reads it — that a book claiming version 3 without a
usable one should be repaired rather than rendered empty. Its own guard makes
it a no-op after the first run.

## What an export is

`{version, exportedAt, settings, spells}` — the whole book, pretty-printed, with
no audio. A restored book therefore shows voice notes as *recording lost*. That
is the deliberate split: the export is the portable book, the backup folder is
the complete one.

**Restore** replaces the document wholesale, keeping counters, graveyard state
and settings; it writes a `pre-restore-` copy of the current book first.
**Merge** folds spells in without touching your history: counters take
`Math.max(stored, incoming)`, a buried spell is never resurrected, and settings
are ignored because they belong to this phone.
