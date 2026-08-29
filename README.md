# Spellbook

A personal spellbook for Android. One Kotlin activity hosting a WebView; the
app itself is a web page in `app/src/main/assets/`.

- **What it is and why** — [`docs/design.md`](docs/design.md)
- **How it's put together** — [`docs/architecture.md`](docs/architecture.md)
- **Working on it** — [`CLAUDE.md`](CLAUDE.md)
- **What's next** — [`docs/roadmap.md`](docs/roadmap.md)

## Getting an APK

1. Push to `main`. The Actions workflow runs on every push.
2. Open the **Actions** tab, click the run, and download the `spellbook-apk`
   artifact at the bottom.
3. Unzip it and open `app-debug.apk` on the phone. You'll be asked once to
   allow installing from unknown sources.

Builds take three to five minutes. A second, much faster workflow runs the
smoke suite on the same push; it never touches the Gradle path, so a red test
can't stop you getting an APK you wanted anyway.

## Updating without losing your book

Every build is signed with `app/spellbook.keystore`, which is committed to this
repo. That is what lets a new APK install *over* the old one, keeping your data.

Without it, each CI run generates its own throwaway key, Android sees a
signature mismatch and refuses the update — and uninstalling to get around that
deletes `files/spellbook.json` and every backup with it.

The keystore is not a secret. It signs a personal app for a personal phone. Do
not delete or regenerate it: a new key means another forced uninstall.

You can confirm it in the Actions log — the "Show signing fingerprint" step
prints a SHA-256 that should be byte-identical on every run.

## Iterating

Edit, push, download the new APK. There is no build step for the web layer: the
file you edit is the file that runs.

You can also open `app/src/main/assets/index.html` in a desktop browser to work
on the UI. It runs — that's preview mode, with the book in memory rather than
on disk, since there's no bridge outside the app. `node tools/smoke.mjs` drives
exactly that, plus a fake bridge for everything behind it.

## Where your spells live

`/data/data/com.spellbook/files/spellbook.json` — private to the app, kept
through updates, deleted only if you uninstall or clear app data. The format is
in [`docs/data-format.md`](docs/data-format.md).

A dated copy goes to `files/backups/` the first time you change something each
day, seven kept, reachable from **Vault → Earlier versions**. **Export the
book** writes a copy to Downloads; that's the one you'd carry to a new phone,
and **Restore from a file** is how it comes back — with its counts, its shelf
and graveyard, and its settings.

Voice notes are not in that file. Each one is an `.m4a` in `files/media/`, and
the note carries only its filename. **The export therefore does not carry your
recordings**, and a book restored from one shows those notes as *recording
lost*. That is the deliberate split: the export is the portable book, the backup
folder is the complete one.

## The backup folder

Pick one in Vault → **Backup folder** and the book plus every recording is
copied there once a day, riding along on an ordinary save. Point it at a folder
some sync app already mirrors — Autosync, FolderSync, Syncthing — and the
offsite copy needs no code here at all.

Pick nothing and the old weekly JSON drop into Downloads carries on exactly as
before, so the app is never less safe than it was.

Android's own app backup is not a substitute, though `allowBackup` is on: it
restores only when an app is installed as part of setting up a phone, never when
you sideload an APK onto a phone already running — which is the whole install
story here.

## A note on the repo contents

The seed baked into the APK is synthetic — 48 generated spells that exist to
give a fresh install something to open and the test suite a fixture. **No real
spells are in this repository**, and none should be pasted into
`app/src/main/assets/js/seed.js`. Your book lives on the phone.
