# Changelog

What has shipped, oldest first. This is a changelog and nothing else: later
entries contradict earlier ones on purpose, because that is what a changelog
is. **It is not a description of the app as it stands** — for that, read
`docs/design.md` for the vocabulary, `docs/architecture.md` for how it is put
together, and `docs/bridge.md` for the contract between the two halves.

- Draw ritual — sigil, cast animation, reveal, six-second re-inscription cooldown
- 1–3 spells per cast, staggered reveal
- Sticky tag filters, persisted between sessions
- No-repeat window of 12
- Library with search, the sticky filters, and three sort orders
- Tag index with counts
- Spell detail with source behind a tap
- Mark useful, with count
- Graveyard — reversible, browsable
- Write a spell by hand
- Triage, ordered by situation poverty
- Import (merges by id) and export
- Daily rotating backup, seven kept
- Retag by situation; concepts deleted
- Computed tags — `question` and `untagged` derived at render time
- Import replaces authored tags rather than unioning them
- Tag management — rename and remove, two-tap confirm, renames follow active filters
- Review quick action on every card
- Bold, italic and highlight in the editor
- Fixed signing key committed to the repo, so updates install over
- Fixed: edited spells re-render on the draw screen immediately
- Fixed: `useful` is its own computed, filterable tag, same mechanism as `question`/`untagged` — no proven/unproven axis needed, it just shows up in the tag list
- Fixed: the review quick action now sets `needs-review` rather than `review` — one tag standing for both "imported wrong" and "didn't help, reconsider." Icon changed from a bookmark to a flag; legacy `review` tags migrate on load
- Automatic weekly export to Downloads via MediaStore, riding along on every save
- Fixed: the filter sheet splits into **Situations** (tap any that apply, OR'd) and **Type & marks** (per-tag Require/Never, AND'd) — replacing the three-state cycle. Old sticky filters migrate into the new shape on load
- Fixed: "Only" renamed to "Require" — clearer that several Require tags all have to hold at once, not that only one does
- The library can now be filtered the same way the draw is — a filter chip alongside search, sort and the graveyard toggle
- Fixed: a tag on a card only turns brass when it's part of your active filter selection, not just because it's a situation — drawing no longer paints every situation tag orange regardless of what you asked for
- Removed A–Z from the library sort order, down to Recent / Most useful / Most drawn
- **The desk** — a fifth quick-action (a pin) on every card, alongside useful/review/source/bury. Its own nav tab, most-recent-first. Falls off after three days into a fading **recently decayed** shelf, gone three days after that. Re-pinning — the same action, on either shelf — refreshes the clock and rescues a fading spell back to the top. Stored as a timestamp only, so decay needs no cleanup job. The pin lights brass, the decayed shelf desaturates and dims, and the desk's header carries a faint lamp glow.
- **The inbox.** Shipped as an ordinary tag (`inbox`), not the third `state` this was first sketched as — it gets the same tag management and Require/Never filtering as everything else, for free. Newly written or imported spells carry it; migrated once, retroactively, over everything already in the book that wasn't already marked useful. Over-represented in the draw by a weight set in Vault → The draw (`inboxWeight`, default 3×). Shows an *untested* badge when drawn, so a miss reads as *this one didn't work* rather than *the book is noisy*. A `useful` mark strips it automatically; it can also be removed by hand, same as any authored tag.
- **`needs-review` renamed to `flagged`**, and locked in the tag manager — can't be renamed or removed as a tag there (per-spell it still toggles freely from the card's flag action or the editor). The old `review` bookmark and `needs-review` both migrate to it on load. Gets its own draw-weight setting alongside inbox's (`flaggedWeight`, default 1 — no effect; try 0.8 to quietly draw flagged spells less often). The two weights multiply when a spell carries both tags.
- **Hypothetical counts in Type & marks.** Once any filter is active (a situation picked, or another tag Required/Never'd), every Type & marks row crosses out its plain count and shows what the pool would shrink to if that tag were *also* Required — combining with the current situations (OR'd) and current Require set (AND'd). A tag already set to Never shows 0, correctly, since requiring and forbidding the same tag can't both hold.
- **Tag kind is now editable, not hardcoded.** Whether a tag lives in Situations (OR'd) or Type & marks (its own Require/Never) used to be fixed by membership in the `SITUATIONS` list. The tag manager now has a Situation / Type & mark toggle for any tag; a choice that diverges from the default is stored as an override, so new tags still classify correctly without needing an entry anywhere. Switching a tag's kind migrates it out of whichever filter bucket (Situations/Require/Never) no longer applies to it — Situations has no Never, so that clears; Require carries across to Situations' OR-selection and back.
- **Text notes on a spell.** A sixth quick-action (a speech bubble) on every card, alongside useful/flag/desk/source/bury — opens a short sheet, nothing but a textarea, so logging what happened stays as fast as marking a spell useful. Notes accumulate as a thread rather than replacing each other; each carries its own timestamp. Reading the thread is the extra step this was designed to avoid cluttering the card with: a **Notes** button on the spell's detail sheet (tap a row in the library), showing the count once there's at least one, opens the full thread oldest-first with a composer at the bottom for the next entry. A note can be deleted from the thread. Storage shape is deliberately generic — `{id, type, text, createdAt}` — so a queued voice note can land in the same array as `{type:'voice', file}` without restructuring anything. Made room for the sixth icon by dropping the "useful" text label — the heart now shows only a count once it has one, icon-only otherwise, same as the other five actions.
- **Voice notes on a spell.** A *Say it instead* button in both note composers; the recording itself is native Kotlin, because the web layer can ask for a microphone but not choose which one, and choosing is most of the point. Audio lands in `files/media/` as one AAC file per note, with only the filename on the note — a voice note is `{type:'voice', file, duration}` in the same thread as the text ones, exactly the slot the notes array was shaped for. Plays back in the thread over the app's own internal origin, so nothing had to loosen file access. Records through a Bluetooth headset when one is connected, off a toggle in the Vault, and **the recorder names the microphone it is actually on while you record** rather than the one it asked for — the first version reported the request and was wrong about it. Deleting a note deletes its audio; audio no note refers to is swept at boot. Not available in desktop preview, where there's no bridge to record through.
- **A backup folder you choose.** Vault → *Backup folder*, picked once and remembered. The book plus every recording is copied there once a day, riding along on an ordinary save the way the weekly export already did: dated JSON snapshots, fourteen kept, and `media/` as a mirror — each recording copied once and never again, matched by stem so a provider renaming the extension can't turn the mirror into a pile of duplicates. Point it at a folder some sync app already watches and the offsite copy needs no code here. Pick nothing and the weekly Downloads export carries on unchanged, so the app is never less safe than it was. The export itself still carries no audio, and a book restored from one shows those notes as *recording lost*.
- **The home screen widget.** One spell, changing at midnight, tapping opens the book. Native Kotlin reading `spellbook.json` directly — the thing the plain file was always for. Read-only: nothing on the home screen counts as a draw, so it can't race the WebView's save. Which spell you get is derived rather than stored — the day number seeds the pick, so every refresh inside a day agrees, and the three weeks before it are recomputed to keep a spell from coming round twice in a week. Draw weights apply, sticky filters don't. See `docs/decisions/0007-widget-derives-its-pick.md`.
- **Widget tap opens that spell's detail sheet**, rather than just landing on whatever screen the app remembers. Resolves half of the widget's open question — the intent now carries `spell:<id>` through `MainActivity`'s existing `EXTRA_OPEN` channel (the same one reminders already use for `draw`), and the page routes straight to `openSpell()` for that spell on boot and on a live `onNative` open event alike. Long-press re-roll is still open.
- **Daily reminders.** Vault → *Being called* → **Reminders**. Up to three times a day, each a row with a time picker; a shared message, editable, defaulting to *The book is open. Where are you?*. Tapping one opens the book at the sigil with the last cast cleared away and **nothing drawn** — the notification is a knock, not a draw, which is what keeps `drawn` and `lastDrawn` honest when a reminder goes unopened. Times and wording are settings in `spellbook.json` like everything else, so they export, back up and restore with the book, and Kotlin reads them at boot without the WebView exactly as the widget reads spells. One alarm per slot, inexact and allowed while idle — the widget's midnight bargain, no exact-alarm prompt, a few minutes of drift at worst. Re-armed after each fire, on every launch, and on the four broadcasts that invalidate an alarm: boot, app update, clock change, timezone change. A save re-arms only when the times actually changed, compared against a stored signature, since the book is written on every edit and the times change twice a year. `POST_NOTIFICATIONS` is asked for the first time a time is set and never otherwise; two refusals and Android stops showing the prompt, so the Vault offers a way through to system settings, and coming back from there re-checks quietly rather than going on insisting it's blocked. One notification id for all three slots — an unread reminder is replaced rather than stacked.
- **minSdk raised to 31.** Voice notes route microphone input with `setCommunicationDevice`, which arrived in Android 12. The deprecated `startBluetoothSco` path it replaces wasn't worth carrying for a personal app on a phone running 16.
## The refactor pass

- **`tools/smoke.mjs`** — the app is a web page, so it can be driven headlessly
  without building an APK. Serves `app/src/main/assets/` and runs the real
  `index.html` in Chromium, first in preview mode and then against a scriptable
  fake bridge. It found a shipped bug on its first run against unmodified
  `main`.
- **Fixed: `@keyframes pulse` was defined twice.** The later definition replaced
  the earlier one entirely, so the sigil's two inner circles — which asked for a
  gentle opacity breath — had been running the voice recorder's scale-and-fade
  since voice notes shipped. The recorder's is now `pulse-dot`.
- **The seed is synthetic.** 46 generated spells replacing 148 real ones,
  written one per line so it diffs. Removes the privacy problem at the source,
  makes the staleness problem structurally impossible, and gives the test suite
  a fixture that doesn't change under it.
- **The single file became nine.** `index.html` 2,133 lines → 1,355; the cold
  sections moved to `css/app.css` and eight files under `js/`. Plain script
  tags, shared globals, no build step, still opens directly in a browser.
- **Fixed: an unreadable book is no longer indistinguishable from no book.**
  Three states used to collapse into `null` — no file, a file that won't parse,
  a file that won't read — and seeding is the right answer to only the first.
  Kotlin now answers `bookState()`, `Store.load()` returns a state rather than
  `null`, and a book that won't open gets a **recovery screen** that writes
  nothing at all.
- **Two kinds of import, at last.** *Restore from a file* replaces the book
  wholesale — spells, counts, graveyard state and settings — keeping the current
  book as a `pre-restore-` copy first, so a mistaken restore is itself
  reversible. *Merge in spells* folds another book into yours: counters now take
  the maximum of stored and incoming rather than being skipped, and a spell you
  buried is never resurrected.
- **Fixed: exported settings are read back.** `exportBook` had always written
  `settings`, and `importBook` had never looked at it — so a restore lost
  reminder times, wording, draw weights, filters, sort order and
  `tagKindOverrides`.
- **Vault → Keeping → Earlier versions.** The daily snapshots in `files/backups/`
  have existed since the first save and nothing could reach them without adb.
  Now they are listed with their date and spell count, and restore through the
  same path as any other file. Also reachable from the recovery screen, which is
  the case they exist for.
- **`doc.version` moves again.** `SCHEMA = 2`, stamped on every `persist()`;
  migrations run forward from the version the file claims, with their per-field
  guards kept as belt-and-braces for books written before the stamp existed.
- **Boot writes once.** It used to write up to six times — the seed, then each
  of five migrations — and every write is a full pipeline in Kotlin.
- **The offsite backup left the caller's thread.** `save()` ran the SAF write
  inline on the thread the JavaScript caller was blocked on, which on the first
  save of a day with a backup folder set was felt as a random tap that hung.
- **One way to redraw a card.** `patchCard()` replaces two implementations that
  had already drifted apart, and one tag strip replaces four copies.
- **Sheets have names.** `window.onNative` used to find the reminders sheet by
  matching its title text; renaming the copy would have silently stopped the
  notification-permission refresh.
- **The reminder cap and the default wording are Kotlin's alone.**
  `notifyState()` had been sending both across the bridge all along and the page
  ignored them in favour of its own copies.
