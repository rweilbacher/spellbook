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

## A note on the repo contents

`index.html` has the spells baked in, so the repository holds your notes. Keep
it private. If you'd rather it didn't, delete the array between the `SEED`
markers near the top of the script block, leaving `const SEED = [];`, and load
your spells with **Import** on the device instead.

## Later: a home screen widget

The reason the data is a plain JSON file rather than IndexedDB. A widget is
native Kotlin and can read that file directly; it could not read a browser
database. Nothing in the current app needs to change to add one.
