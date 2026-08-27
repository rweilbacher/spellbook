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

## Bugs

- **Restoring a backup silently drops your counts.** Import never overwrites `useful`, `drawn` or `state` — right when merging, wrong when restoring. After an uninstall the app seeds from the APK with everything at zero; importing your export leaves it at zero, because the ids already exist. Fixed properly by splitting import in two (spec below); the merge path should also take the maximum of stored and incoming counts.

---

# Queue

## Next

- **Two kinds of import.** Spec below.
- **Weighted draw**, defaulting to favouring the never-drawn. One switch, reversible.
- **Text notes on a spell.** Any spell can accumulate what happened when you used it. Over a year this is the most interesting data in the book.
- **Exhume.** Occasionally the draw offers something buried, marked as such. Keeps burial from feeling final.

## Later

- **Home screen widget.** A spell in peripheral vision, changing daily. The reason the store is a plain file.
- **Notifications at set intervals.** A spell arriving unbidden — closer to the original wish than anything requiring you to open an app. `POST_NOTIFICATIONS` on Android 13+, periodic work rather than exact alarms. The notification picks its own spell, so Kotlin reads the book file directly. *This is the same capability the widget needs — build either and the other is nearly free.*
- **Dark spells.** Spec below.
- **Android share target** — highlight text anywhere, share into the inbox.
- **The djinn.** Spec below.
- **Voice notes on a spell.** Microphone permission and a second bridge method; audio goes to its own files with only filenames in the JSON. Base64 in the book would take it from 100KB to megabytes, rewritten on every edit.
- **Swipeable stack** for multi-spell draws, if scrolling three keeps feeling wrong.

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
