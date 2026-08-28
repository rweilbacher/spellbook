# 1. One JSON file, not IndexedDB

**Status:** accepted · load-bearing for 0007 and for reminders

## Decision

The whole book is one JSON file in the app's private directory,
`files/spellbook.json`, rewritten in full on every edit.

## Why

A file can be read by the home-screen widget, by `Reminders` at boot before the
WebView exists, copied out as a backup, and carried into a native rewrite with
no migration. A browser database can do none of those things: it is reachable
only from inside the WebView, by the page, while the page is running.

At ~150 spells the file is around 100KB, so rewriting it on every edit is free.
Write-then-rename means a crash mid-write can't leave half a book.

## Consequences

- **Audio never goes in it.** A megabyte of base64 in a file rewritten on every
  keystroke would make every keystroke expensive. Voice notes are files in
  `files/media/` with only the filename on the note. Same answer for images, if
  they ever arrive.
- The widget and the page can't both write. The widget therefore never writes —
  see 0007.
- Every derived property stays derived, because there is no index to keep.
