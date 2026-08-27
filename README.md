# Spellbook

A personal spellbook for Android. One Kotlin activity hosting a WebView; all of
the app is a single HTML file in `app/src/main/assets/`.

## Getting an APK without installing anything

1. Make a **private** repository on GitHub and push this folder to `main`.
2. The Actions workflow runs on every push. Open the **Actions** tab, click the
   run, and download the `spellbook-apk` artifact at the bottom.
3. Unzip it and open `app-debug.apk` on your phone. You'll be asked once to
   allow installing from unknown sources.

Builds take three to five minutes. Free for private repos within the 2,000
minutes a month the free plan includes; unlimited if the repo is public.

Debug builds are signed with Android's standard debug key, which is fine for
sideloading onto your own phone. A Play Store release would need a real keystore.

## Updating without losing your book

Every build is signed with `app/spellbook.keystore`, which is committed to this
repo. That is what lets a new APK install *over* the old one, keeping your data.

Without it, each CI run generates its own throwaway key, Android sees a
signature mismatch and refuses the update — and uninstalling to get around that
deletes `files/spellbook.json` and every backup with it.

The keystore is not a secret. It signs a personal app for a personal phone. Do
not delete or regenerate it: a new key means another forced uninstall.

**One last uninstall is needed** to move from the old unsigned-consistently
builds to this one. Before you do it: open the Vault, tap **Export the book**,
and check the JSON is in your Downloads folder. Then uninstall, install the new
APK, and use **Import spells**. Every update after that is install-over.

You can confirm the fix in the Actions log — the "Show signing fingerprint" step
prints a SHA-256 that should be byte-identical on every run.

## Iterating

The only file you normally touch is `app/src/main/assets/index.html`. Edit it,
push, download the new APK. You can also open that file in a desktop browser to
work on the UI — it runs, but keeps everything in memory rather than on disk,
since there's no bridge outside the app.

## Where your spells live

`/data/data/com.spellbook/files/spellbook.json` — private to the app, kept
through updates, deleted only if you uninstall or clear app data.

A dated copy goes to `files/backups/` the first time you change something each
day, seven kept. **Export** in the Vault writes a copy to your Downloads folder;
that's the one you'd carry to a new phone.

Voice notes are not in that file. Each one is an `.m4a` in
`files/media/`, and the note carries only its filename — audio in the JSON would
take it from 100KB to megabytes, rewritten on every keystroke. **The export
therefore does not carry your recordings**, and a book restored from one shows
those notes as *recording lost*. That is the deliberate split: the export is the
portable book, the backup folder below is the complete one.

## The backup folder

Pick one in Vault → **Backup folder** and the book plus every recording is
copied there once a day, riding along on an ordinary save. Fourteen dated
snapshots are kept; audio is never pruned. Point it at a folder some sync app
already mirrors — Autosync, FolderSync, Syncthing — and the offsite copy needs
no code here at all.

Pick nothing and the old weekly JSON drop into Downloads carries on exactly as
before, so the app is never less safe than it was.

Android's own app backup is not a substitute, though `allowBackup` is on: it
restores only when an app is installed as part of setting up a phone, never when
you sideload an APK onto a phone already running — which is the whole install
story here.

## A note on the repo contents

`index.html` has the spells baked in, so the repository holds your notes. Keep
it private. If you'd rather it didn't, delete the array between the `SEED`
markers near the top of the script block, leaving `const SEED = [];`, and load
your spells with **Import** on the device instead.

## Later: a home screen widget

The reason the data is a plain JSON file rather than IndexedDB. A widget is
native Kotlin and can read that file directly; it could not read a browser
database. Nothing in the current app needs to change to add one.
