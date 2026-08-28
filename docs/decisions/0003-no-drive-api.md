# 3. A folder you choose, not the Drive API

**Status:** accepted · shipped

## Decision

Vault → **Backup folder**: Android's folder picker, the grant persisted, and
the book plus every recording copied there once a day, riding along on an
ordinary save. Pick nothing and the weekly Downloads export carries on.

## Why

The automatic weekly JSON copy to Downloads was insurance built when the book
was the only thing worth insuring. Audio changes that, and Downloads is the
wrong place to accumulate a media folder.

**Pick a folder once, in the Vault.** Android's folder picker, with the grant
persisted, so the app can keep writing there indefinitely. Into it, at most
once a day and riding along on an ordinary save exactly as the weekly export
does now: the book as `spellbook-YYYY-MM-DD.json`, and every audio file not
already there, under `media/`. Fourteen dated snapshots kept.

**The book is snapshotted; audio is mirrored.** Fourteen dated copies of a
100KB JSON file is nothing. Fourteen copies of the recordings would be the
whole point of the feature, wasted — so `media/` is a mirror, one copy of each
recording, written once and never again.

Getting that right is fiddlier than it sounds, because the app doesn't own the
filename in that folder: it hands a display name to whatever provider backs it,
and the provider may normalise the extension to match the MIME type. Match
"already backed up" on the full filename and it can miss on every run — copying
every recording again each day, each copy politely uniquified with a `(1)`.
So identity is the stem, `vn_ab12cd`, which survives whatever happens to the
extension. Anything else sharing a stem is a half-finished copy from an
interrupted run, not a second backup, and is cleaned up on the next pass.

**Deleting a note doesn't delete its backup.** A recording removed on the phone
stays in the backup folder. That's the correct default — a backup that deletes
what you deleted isn't insurance against deleting the wrong thing — but it does
mean `media/` only ever grows, and it's the obvious thing to revisit if it ever
gets big enough to notice.

**Offsite is somebody else's problem, deliberately.** Point the folder at
something a sync app already mirrors — Autosync, FolderSync, Syncthing — and
the Drive copy happens with no code here at all. Talking to the Drive API
directly was considered and rejected: a Cloud project, a consent screen, and
for an app that never gets published, tokens that expire weekly. Days of work
and permanent friction to replace a folder path.

**Android's own app backup is not the answer either**, though `allowBackup` has
been on this whole time and it's plausibly been copying `spellbook.json` to
Google's servers all along. It restores only when an app is installed as part
of setting up a phone — never when you sideload an APK onto a phone already
running, which is the entire install story here. Real insurance against losing
the phone, no help at all in the situation the README is actually about. It
also caps at 25MB, which audio would eat.

**Nothing changes if you don't set a folder.** The weekly Downloads export
stays exactly as it is, so the app is never less safe than it was.

## Consequences

- The offsite copy is somebody else's problem, and that is the point: point the
  folder at something Autosync, FolderSync or Syncthing already watches and the
  cloud copy needs no code here at all.
- `media/` in that folder only ever grows — a backup that deletes what you
  deleted isn't insurance against deleting the wrong thing. The obvious thing to
  revisit if it gets big enough to notice.
- Identity in that folder is the filename *stem*, because the app doesn't own
  the filename there: it hands a display name to a provider that may normalise
  the extension.
