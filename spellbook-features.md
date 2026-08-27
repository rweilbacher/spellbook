# Spellbook

Living document. Four parts: **reference** (things that are settled), **state**
(what's built, what's broken), **queue** (what's next), **specs** (the features
big enough to need thinking through).

---

# Reference

## Principles

1. **Retrieval is by situation, not subject.** You open the book in a state, not in a topic. The index has to match the way you arrive.
2. **Derived properties are not tags.** Anything computable from the spell — its length, whether it's a question, its language — is computed when needed, never stored. Stored derivations go stale on the first edit.
3. **A spell earns its place by being used, not by being written.** Curation happens through the draw and the graveyard, not through a big upfront sort.
4. **Nothing leaves the device unless you ask.** The djinn is the single exception and it's opt-in.
5. **The file is the truth.** One JSON file, readable by a widget, portable to a rewrite, exportable as backup.

## The vocabulary

**Situations — 15, the primary index.** Phrased as states. A spell takes one or two; overlap is expected.

`spiralling` · `stuck` · `avoiding` · `defending` · `disconnected` · `overwhelmed` · `afraid` · `self-attacking` · `in-my-head` · `flat` · `rushing` · `wanting` · `with-her` · `among-people` · `arriving`

**Form — secondary.** `practice` (a procedure, not a line) · `prompt` (wants twenty minutes) · `flagged` (reconsider this — imported wrong, or tried and it didn't help; locked, can't be renamed or removed as a tag) · `inbox` (new, unproven — a `useful` mark strips it; burying just removes the spell from the draw, tag and all, until it's exhumed)

**Computed, never stored.** `question` · `untagged` · `useful`

**Deleted in the retag:** `care`, `body`, `sacred`, `shadow`, `agency`, `attention`, `connection`, `desire`, `expression`, `fear`, `pace`, `relationship`, `de`, `whisper`, plus the wikilink singletons.

A spell matching no situation keeps no tags and shows as `untagged`. That pile is a finding, not a gap.

**Two kinds of filter, matched to two kinds of tag.** Situations (plus `untagged`, the unsituated state) describe where you are — tap any that apply in the filter sheet and they OR together: a spell needs to match at least one. Everything else — form and computed tags alike — describes what the spell *is*, and gets its own **Require** / **Never** per tag: Require tags AND together (a spell must have all of them), Never tags rule a spell out if it has any of them. The two groups always combine with AND. ("Only" was the first name for Require — dropped because it reads as exclusive when several are on at once, and it's really "all of these," not "just this one.") The same filters narrow both the draw and the library.

**Orange marks what you asked for, not what a spell is.** A tag lights up on a card only when it's part of your current filter selection — the situations you picked, the tags you set to Require. A situation or type tag just sitting on the spell, unselected, stays plain. This keeps the color meaning one thing: this is why you're looking at this spell right now.

---

# State

## Shipped

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
- **The inbox.** Shipped as an ordinary tag (`inbox`), not the third `state` this was first sketched as below — it gets the same tag management and Require/Never filtering as everything else, for free. Newly written or imported spells carry it; migrated once, retroactively, over everything already in the book that wasn't already marked useful. Over-represented in the draw by a weight set in Vault → The draw (`inboxWeight`, default 3×). Shows an *untested* badge when drawn, so a miss reads as *this one didn't work* rather than *the book is noisy*. A `useful` mark strips it automatically; it can also be removed by hand, same as any authored tag.
- **`needs-review` renamed to `flagged`**, and locked in the tag manager — can't be renamed or removed as a tag there (per-spell it still toggles freely from the card's flag action or the editor). The old `review` bookmark and `needs-review` both migrate to it on load. Gets its own draw-weight setting alongside inbox's (`flaggedWeight`, default 1 — no effect; try 0.8 to quietly draw flagged spells less often). The two weights multiply when a spell carries both tags.
- **Hypothetical counts in Type & marks.** Once any filter is active (a situation picked, or another tag Required/Never'd), every Type & marks row crosses out its plain count and shows what the pool would shrink to if that tag were *also* Required — combining with the current situations (OR'd) and current Require set (AND'd). A tag already set to Never shows 0, correctly, since requiring and forbidding the same tag can't both hold.
- **Tag kind is now editable, not hardcoded.** Whether a tag lives in Situations (OR'd) or Type & marks (its own Require/Never) used to be fixed by membership in the `SITUATIONS` list. The tag manager now has a Situation / Type & mark toggle for any tag; a choice that diverges from the default is stored as an override, so new tags still classify correctly without needing an entry anywhere. Switching a tag's kind migrates it out of whichever filter bucket (Situations/Require/Never) no longer applies to it — Situations has no Never, so that clears; Require carries across to Situations' OR-selection and back.
- **Text notes on a spell.** A sixth quick-action (a speech bubble) on every card, alongside useful/flag/desk/source/bury — opens a short sheet, nothing but a textarea, so logging what happened stays as fast as marking a spell useful. Notes accumulate as a thread rather than replacing each other; each carries its own timestamp. Reading the thread is the extra step this was designed to avoid cluttering the card with: a **Notes** button on the spell's detail sheet (tap a row in the library), showing the count once there's at least one, opens the full thread oldest-first with a composer at the bottom for the next entry. A note can be deleted from the thread. Storage shape is deliberately generic — `{id, type, text, createdAt}` — so a queued voice note can land in the same array as `{type:'voice', file}` without restructuring anything. Made room for the sixth icon by dropping the "useful" text label — the heart now shows only a count once it has one, icon-only otherwise, same as the other five actions.
- **Voice notes on a spell.** A *Say it instead* button in both note composers; the recording itself is native Kotlin, because the web layer can ask for a microphone but not choose which one, and choosing is most of the point. Audio lands in `files/media/` as one AAC file per note, with only the filename on the note — a voice note is `{type:'voice', file, duration}` in the same thread as the text ones, exactly the slot the notes array was shaped for. Plays back in the thread over the app's own internal origin, so nothing had to loosen file access. Records through a Bluetooth headset when one is connected, off a toggle in the Vault, and **the recorder names the microphone it is actually on while you record** rather than the one it asked for — the first version reported the request and was wrong about it. Deleting a note deletes its audio; audio no note refers to is swept at boot. Not available in desktop preview, where there's no bridge to record through.
- **A backup folder you choose.** Vault → *Backup folder*, picked once and remembered. The book plus every recording is copied there once a day, riding along on an ordinary save the way the weekly export already did: dated JSON snapshots, fourteen kept, and `media/` as a mirror — each recording copied once and never again, matched by stem so a provider renaming the extension can't turn the mirror into a pile of duplicates. Point it at a folder some sync app already watches and the offsite copy needs no code here. Pick nothing and the weekly Downloads export carries on unchanged, so the app is never less safe than it was. The export itself still carries no audio, and a book restored from one shows those notes as *recording lost*.
- **The home screen widget.** One spell, changing at midnight, tapping opens the book. Native Kotlin reading `spellbook.json` directly — the thing the plain file was always for. Read-only: nothing on the home screen counts as a draw, so it can't race the WebView's save. Which spell you get is derived rather than stored — the day number seeds the pick, so every refresh inside a day agrees, and the three weeks before it are recomputed to keep a spell from coming round twice in a week. Draw weights apply, sticky filters don't. Spec below.
- **minSdk raised to 31.** Voice notes route microphone input with `setCommunicationDevice`, which arrived in Android 12. The deprecated `startBluetoothSco` path it replaces wasn't worth carrying for a personal app on a phone running 16.

## Bugs

- **Restoring a backup silently drops your counts.** Import never overwrites `useful`, `drawn` or `state` — right when merging, wrong when restoring. After an uninstall the app seeds from the APK with everything at zero; importing your export leaves it at zero, because the ids already exist. Fixed properly by splitting import in two (spec below); the merge path should also take the maximum of stored and incoming counts.

---

# Queue

## Next

- **Two kinds of import.** Spec below.
- **Weighted draw**, defaulting to favouring the never-drawn. One switch, reversible.
- **Exhume.** Occasionally the draw offers something buried, marked as such. Keeps burial from feeling final.

## Later

- **Notifications at set intervals.** A spell arriving unbidden — closer to the original wish than anything requiring you to open an app. `POST_NOTIFICATIONS` on Android 13+, periodic work rather than exact alarms. *Most of this is now built: `Book.spellOfTheDay` is the read, and `SpellWidget` already owns an alarm that survives reboots and clock changes. What's left is the permission prompt, a channel, and deciding whether a notification draws its own spell or carries the one the widget is showing.*
- **Dark spells.** Spec below.
- **Android share target** — highlight text anywhere, share into the inbox.
- **The djinn.** Spec below.
- **Swipeable stack** for multi-spell draws, if scrolling three keeps feeling wrong.
- **Add an image to a spell.** Same shape problem as voice notes, and it should follow the same answer — its own file in `files/media/`, a filename on the note, carried by the backup folder and not by the export. Store the picture in its own file (bridge method to write bytes from a data URL or picked file, mirroring how `save`/`export` already work) and keep only a filename on the spell. Needs a picker path in the editor — either the existing file-chooser plumbing in `MainActivity`, or a small camera/gallery intent — and a place to show it on the card and detail sheet.

## Someday — spellbooks in a room together

Low priority, genuinely fun, unspecified. Playing with other people's books at events, across the iOS/Android gap, without a server.

**Exchange** is the easy half: a QR code carries a spell or a small set, readable by any camera. No app, no network, no pairing.

**Games** need shared state. The trick that fits: one phone hosts a small web server over the venue wifi and everyone else joins by opening a URL. No iOS app, because there is no app — the host's phone is the venue. The architecture already suits this, since the whole thing is a web page.

Ideas, unfiltered: spells drawn against each other with the room voting on which lands harder; drawing from a stranger's book; a shared draw where everyone gets the same spell and says what it means to them.

---

# Specs

## Two kinds of import

One menu item doing two incompatible jobs is what caused the lost counts. Split it.

**Restore from backup** — replaces the book wholesale. Spells, counts, graveyard state, tags and settings all come from the file; anything currently on the phone is discarded. This is the post-uninstall path and the undo-a-disaster path. Destructive, so: confirm explicitly, and write a safety copy of the current book to `backups/` first, so a mistaken restore is itself reversible.

**Import spells** — merges, roughly as it does now. Known ids get their text and authored tags updated. Unknown ids are appended. Counts take the maximum of stored and incoming rather than being skipped. A buried spell is never resurrected by a merge. This is the path for pulling in a fresh export from the vault, or someone else's spells.

The distinction to keep straight: restore trusts the file completely, merge trusts the phone.

## The inbox — shipped

The threshold for adding a spell should be near zero, but a spell that just arrived hasn't earned anything. The inbox reconciles those.

- Shipped as a tag (`inbox`), not the third `state` this section originally sketched — simpler, and it comes with tag management (rename, remove) and Require/Never filtering for free, the same as `practice`/`prompt`/`flagged`. New spells — written by hand, imported — land here; migrated once, retroactively, over everything already in the book that wasn't already marked useful.
- **Preferential treatment means more exposure, not more trust.** Over-represented in the draw by a weight set directly in Vault → The draw (`inboxWeight`, default 3×), rather than a fixed multiplier — see Draw weighting, below.
- Visibly marked as untested when drawn, so a miss reads as *this one didn't work* rather than *the book is noisy*.
- Promotion by use: one `useful` mark strips the tag. Demotion is the ordinary bury — a buried spell keeps `inbox` (and its weight, if it's ever exhumed) rather than losing it on the way to the graveyard. Can also be removed by hand, same as any authored tag.
- Capture is still the write-a-spell sheet and import; one tap from anywhere still means the Android share target, below.

**Open:** does an inbox spell need tagging before it can be drawn, or is it drawn untagged and tagged only if it survives? Unaffected by the tag-vs-state choice above — still open. Leaning towards the latter — tagging something you're about to bury is wasted effort.

## Draw weighting — shipped

`inbox` and `flagged` (see vocabulary, above) each carry their own multiplier into the draw, set in Vault → The draw: `inboxWeight` (default 3) and `flaggedWeight` (default 1 — no effect; try 0.8 to quietly draw flagged spells less often without hiding them). A spell carrying both multiplies them together. Weight-zero doesn't crash the draw, it just falls back to a plain random pick among whatever's left.

This is separate from the **Weighted draw** queued above, which is about favouring the never-drawn generally, independent of any tag.

## Voice notes — shipped

A note you speak instead of type. It lands in the same thread as the text ones,
carries the same timestamp, deletes the same way. A text note is
`{type:'text', text}`; a voice note is `{type:'voice', file, duration}`. The
notes array shipped in this shape on purpose — nothing about the thread had to
change to admit it.

**Not dictation.** Speech-to-text was the cheaper feature by a wide margin — no
new storage shape, no backup problem, notes stay searchable — and it was
rejected because on-device recognition fails exactly where this feature is
used: half-formed thoughts, feeling rather than information, words invented on
the spot. A bad transcript of something you said while shaken is worse than no
note at all. Recording also doesn't foreclose transcription — if the djinn
arrives, a recording can be transcribed later, per note, opt-in, by a model
that's actually good at it.

**Recording is native Kotlin, not the web layer.** The page could have asked
the browser engine for the microphone and shipped the audio back across the
bridge, which would have kept everything in `index.html` and kept working in
desktop preview. It was rejected for one reason: the web API gives you whatever
input device the system considers default, with no say in the matter, and the
headset requirement below makes that disqualifying. Handing off to the system
recorder app was rejected too — it throws you out of the app mid-thought, and
it's the app whose Bluetooth behaviour prompted this in the first place.

So: `startVoiceNote()` / `stopVoiceNote()` / `cancelVoiceNote()` on the bridge,
Kotlin owns the recorder and writes the file, and the page is told only
`{file, duration}` when it's done. Progress — elapsed time and input level —
is pushed back into the page a few times a second so the UI has something
alive to show. The consequence to accept: **no voice notes in desktop preview.**
The mic button simply isn't rendered when there's no bridge, the same way the
storage banner already admits what preview can't do.

**Bluetooth first, knowingly.** When a headset is connected, record through it.
Google Recorder ignoring the headset isn't a bug on their part — a classic
Bluetooth headset mic is a telephone-grade link, 8–16kHz, plainly worse than
the phone's own microphone, and a recorder app is right to prefer fidelity. But
this isn't a recorder app. A voice note gets spoken quietly, hands busy, earbuds
already in, and convenience beats fidelity every time at that moment. Phones and
headsets that both speak LE Audio get proper quality anyway, for free, with
nothing to build.

Practically: bring the link up, wait for it, *then* start capturing, or the
first second or two is lost. If it hasn't connected within about two seconds,
fall back to the built-in mic and say so rather than failing. A toggle in the
Vault turns the preference off for the one time you care how it sounds.

**What a headset actually costs, learned the hard way.** A classic Bluetooth
headset is two devices wearing one name — Windows shows this honestly, listing
an XM4 twice, once as *Stereo* and once as *Hands-free*. Stereo (A2DP) is
high-quality, one direction, no microphone. Hands-free (HFP) is bidirectional
and telephone-grade. The radio can't do both, so the instant anything asks for
the mic the headset drops out of stereo and into call mode — for the whole
phone, not just for us. That switch is the source of every rough edge here:

- *Silence at the front of a note.* Android reporting the device as selected is
  not the same as the link carrying audio. Starting the encoder on that signal
  records the changeover. Fixed by settling for ~450ms after routing confirms.
- *A note with a hole in the middle.* Three candidates, all now closed.
  `VOICE_COMMUNICATION` — the obvious audio source for a call-routed mic —
  applies echo cancellation, automatic gain and noise suppression tuned for
  telephony, and gates quiet speech as noise; `VOICE_RECOGNITION` routes the
  same way without the processing. A notification played through A2DP mid-note
  forces a profile renegotiation and drops the capture, so recording now takes
  exclusive audio focus. And a screen that times out mid-note both triggers our
  own save-on-pause and hits Android's rule that a backgrounded app gets a
  muted microphone, so the screen is held on for the length of a note.
- *The headset behaving differently while recording* — ambient sound coming
  through, ANC changing — is the profile switch. It is also the tell: **if that
  doesn't happen, the headset is not the microphone.** Selecting the device
  with `setCommunicationDevice` is not sufficient on its own; the framework
  only raises the call link when a communication use case is actually in
  progress, and in `MODE_NORMAL` there isn't one. The device reads back as
  selected, the headset stays in stereo, and capture comes off the phone's own
  microphone while the UI cheerfully claims otherwise. `MODE_IN_COMMUNICATION`
  for the length of the recording is what makes it real — and it has to be put
  back afterwards, because it is a whole-phone state.

**The recorder says which microphone it is using, and means it.** Asking for a
device and getting it are different questions, and the first version answered
the first one while appearing to answer the second. `getRoutedDevice()` on the
running recorder is the ground truth; it's polled alongside the level meter and
named on screen — *the headset*, *the phone's microphone* — so a note recorded
on the wrong input is visible while it happens rather than on playback. Polling
rather than reading it once also catches a route that moves out from under a
note halfway through, which is one of the ways a recording ends up with a hole
in it.

The screen-on flag is the proportionate fix, not the correct one. The correct
one is a foreground service with a microphone type, which is what would let a
note keep recording with the screen off. Worth it only if notes start getting
long enough that holding the screen is the thing that feels wrong.

**Where the audio lives.** `files/media/`, one AAC file per note, filename on
the note. Never base64 in the book: at ~100KB the JSON is rewritten on every
single edit, and a megabyte of audio in there would make every keystroke
expensive. The media directory is served over the same internal `https://`
origin the app already uses for its assets, so playback is an ordinary
`<audio>` tag and nothing has to loosen file access. Seeking within a note may
not work — the asset loader doesn't answer range requests — which is fine at
this length and would be the reason to change approach if notes ever got long.

**The export stays JSON, and stays honest about it.** `Export the book`
continues to write one JSON file with no audio in it. A restored book therefore
has voice notes whose recordings are gone, and those render as
*recording lost* rather than a broken player. The offsite copy of the audio is
the backup folder's job, below — that's the split: the export is the portable
book, the backup folder is the complete one.

**Housekeeping is real work and easy to forget.** Deleting a note deletes its
file. A book loaded on a phone that has files nothing refers to sweeps them on
boot. Both go through the bridge with the filename validated against a strict
pattern first — the web layer must never be able to name a path.

**Open:** whether a voice note should ever be transcribed into a text note it
sits beside, or whether the recording alone is the artefact. Deferred until the
djinn exists and there's something to try it with.

## Backups — a folder you choose, shipped

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

## The widget — shipped

One spell on the home screen, changing at midnight. `SpellWidget.kt` is the
whole of it: an `AppWidgetProvider`, a `Book` object that reads the JSON, and a
layout that is the draw screen's card with everything that doesn't survive at
that size taken out — brass rule, spell in serif, sigil and situations in the
footer.

**It never writes.** No `drawn`, no `lastDrawn`, nothing the WebView could be
mid-save on. A spell seen on the home screen for a day hasn't been drawn; it's
been in the corner of your eye, which isn't the same event and shouldn't share a
counter.

**The pick is derived, not stored.** `dayNumber()` — local days since the epoch
— seeds a splitmix64 scramble, and that seeds the weighted draw. Same day, same
spell, whatever wakes the widget; no state to keep, nothing to migrate, and the
same principle as `question` and `untagged`. To keep a spell from coming round
twice in a week the walk starts three weeks back and replays each day forward,
excluding the seven before it. The warm-up has to be longer than the window it
enforces: reconstructing yesterday from a seven-day walk gives yesterday a
shorter history than it actually had, and a reconstruction that disagrees with
what you saw lets a repeat through. At three weeks, ten years of days against
the current book produce none.

**Weights yes, filters no.** `inboxWeight` and `flaggedWeight` apply, so the
home screen honours the same dials as the draw. The sticky filters don't: they
describe where you are while browsing, and a widget stuck on `spiralling`
because that's what you last opened the library with would be a bug wearing a
feature's clothes.

**Midnight is our own alarm, not the widget schedule.** `updatePeriodMillis`
can't go below thirty minutes and doesn't fire while the phone sleeps — wrong on
both counts for a thing that changes once a day. `setAndAllowWhileIdle` on an
inexact alarm costs one wake a day, needs none of the exact-alarm permission
Android 12 put behind a prompt, and lands within a few minutes of midnight.
Boot, a clock change, a timezone change and an app update all re-arm it, and
`save()` refreshes the widget so burying the spell you're looking at takes it off
the home screen immediately.

**Type sizes itself.** Spells run from four words to a paragraph and the widget
is whatever size you dragged it to, so the TextView autosizes between 12 and
21sp rather than picking a size in code. The editor's `**bold**`, `*italic*` and
`==highlight==` come across as spans.

Open: whether a long-press should offer a re-roll, and whether tapping should
land on that spell's detail sheet rather than the app — the second needs an
intent extra through `MainActivity` into the page, which is the first thing the
widget would have to ask of the web app.

## Dark spells

Spells you're already casting without choosing to. *Nobody loves me. This is impossible. I'll never get this right.* Naming one is the whole intervention — you notice the incantation running, you write it down, and it stops being the water you swim in.

**Hard constraint: these must never be drawn as guidance.** A random draw surfacing "nobody loves me" at a low moment would be the app casting the thing at you. So `dark` cannot be an ordinary tag on an ordinary spell — it's a separate kind, excluded from every draw by construction rather than by a filter that could be cleared by accident.

- Its own view, entered deliberately from the Vault — an extra button, seals opening, a moment of ceremony before it lets you in. The friction is the feature: not a place you land in by accident, and the small ritual marks the shift from *using the book* to *looking at what's using you*.
- Logging one is the point, so capture has to be fast. Shares the inbox's capture path.
- Possibly each dark spell pairs with a counter — a real spell from the book that answers it. That pairing is the useful artefact and the reason to revisit rather than just record.
- Patterns over time are the long-term value: which recur, when, around what.

**Open:** whether the pairing is worth the complexity, or whether naming alone does the work.

## The djinn

A connection to the Claude API. Three uses, in the order they should arrive.

**Constraint for all of them: the djinn selects, it never writes.** It returns ids from your book and the app renders your own cards from your own text. An id that doesn't exist is dropped silently. The moment it can generate spells, the book stops being yours and becomes a chat log.

**v1 — ask instead of draw.** You describe your situation in a sentence. It returns two or three spells from your book, each with a line on why. A second way to cast, beside the sigil. No key or no network means the ask affordance simply isn't there; the sigil always works.

**v2 — the tagger.** Proposes situation tags for untagged spells; you accept or reject in triage. This is what makes the vocabulary cheap to change again, and the reason the retag doesn't have to be right the first time.

**v3 — the reader.** Once notes have accumulated: what keeps coming up, which spells actually move you, where the book is thin.

**Technical.** The HTTPS call happens in Kotlin, not JavaScript — the key never enters the web layer and there's no CORS problem. Your own API key, entered in the Vault, stored in a separate file from the book so exports stay shareable. Haiku is enough for selection; the whole book is roughly 12k tokens, a fraction of a cent per call. Sending only `id` and `text` roughly halves that. **Privacy:** this sends your spells to Anthropic's API. Opt-in, off by default, stated plainly.

---

# Open questions

- **What is a spell, exactly?** Working definition: it completes on contact. `watch your feet` lands instantly; `what's the vulnerable thing?` also lands instantly despite being a question; `what would it look like to develop my taste?` wants a notebook and is a prompt. Questions aren't the dividing line — homework is.
- **Where do new spells come from?** Currently noticed in daily notes, marked, exported. The bar for entry might tighten once the book has proven a core.
- **Is `unreal` the sixteenth situation?** Eleven spells match no situation and most are cosmological — statements about how reality works rather than moves you make. Either a missing state, or a second kind of object closer to creed than spell.
- **Does the blind draw survive the djinn?** They're different rituals. The blind one can surprise you with a state you hadn't named.
- **Is 148 the right size?** Unknowable yet. Ask again once fifty have been drawn at least once.
- **The seed drifts.** The copy baked into the APK is frozen at the retag. If the book file is ever empty the app silently restores that stale snapshot, and it looks like a working app with recent work missing. The automatic weekly Downloads export mitigates this now.
