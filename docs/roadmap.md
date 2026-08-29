# Roadmap

What's next, and the specs for the things big enough to need thinking through
before they're built. Anything here that has shipped has moved to
`CHANGELOG.md`, and the reasoning behind it to `decisions/`.

## Next

- **Weighted draw**, defaulting to favouring the never-drawn. One switch, reversible. (Related finding: the draw's no-repeat window — `recent`, capped at `S.noRepeat`, default 12 — is a plain in-memory array, not persisted anywhere. It resets to empty on every app reload, so "no repeat in the last 12" only holds within a single session. The widget's version of the same idea doesn't have this gap — it reconstructs the last three weeks deterministically from the day number instead of remembering anything — worth keeping in mind if "the draw feels more random than the widget" keeps coming up: some of that may be this, not the weighting. The less-random idea below is about the draw, not the widget.)
- **Exhume.** Occasionally the draw offers something buried, marked as such. Keeps burial from feeling final.
- **Widget cadence.** Turning more than once a day, and no longer turning on save. Spec below.
- **Per-screen filters** — draw, book and widget each get their own, replacing the one shared sticky filter. Spec below.
- **Desk amounts and history.** Spec below.
- **A faster way to clear filters in the library.** Today, clearing an active Require/Never/Situation filter means opening the Filters sheet and tapping "Clear all filters" — the tag and pile chips next to it (`#clearTag`, `#clearPile`) already carry their own inline ✕, the filter chip (`#libFilterChip`) doesn't. An ✕ there when a filter is active, or a small clear control beside the sort chip, would match the pattern already on screen.
- **Saving a filter shouldn't need a Done tap.** The Filters sheet applies on change today only after you tap Done — picking a situation or toggling Require/Never should just take effect live, the way the tag and graveyard chips already do.
- **Indestructible tags pinned to the top of the filter list.** `inbox`, `flagged` and `useful` — the tags that can't be renamed or removed — should sort to the top of the Situations/Type & marks filter lists, in that order, rather than falling wherever their name or count puts them. (They now always *appear*, at 0 if that's the count — see the changelog. This is the ordering half, still open.)
- **Slightly bigger quick-action targets.** The useful/flag/desk/note/source/shelve/bury row on each card reads as a little cramped to tap reliably; worth sizing up. Shelving added a seventh icon to it, so this went from worth doing to overdue.
- **Two-tap filtering for situations, brought back.** Situations filtering used to be two taps (pick, then confirm) rather than the current one-tap toggle; worth restoring.
- **A small ✕ on each tag in the detail sheet**, so a tag can be pulled off a spell without opening the editor. Probably needs the tag chips themselves a little bigger to give the ✕ room to be tappable.
- **A true detail section**, with more room than the compact detail sheet gives today. The clearest case is importing tweet bookmarks: land the whole tweet intact and readable, then condense it down into the short, usable spell text separately — so the import isn't a choice between keeping the source and having something quick to draw.
- **The actual spell count per situation, given the current meta-category selection** — not just the hypothetical crossed-out numbers Type & marks already shows, but a plain, always-visible count of what's currently in the pool. Could live alongside the existing hypothetical-count mechanism, or stand alone as an easier-to-see "spells in pool right now" figure.

## Bugs

- **Bold/italic/highlight don't apply.** Selecting text and tapping a formatting button in the editor doesn't format it.
- **Formatting doesn't show in the library list.** A spell with bold/italic/highlight renders correctly in the editor and detail sheet but not in the book/library list view.
- **The OS text-selection toolbar covers the formatting toolbar.** Selecting text to format it brings up the system copy/paste interface, which sits on top of the bold/italic/highlight controls and blocks them.

## Later

- **A spell in the notification itself.** Reminders shipped as a plain knock (below); the older wish was a spell arriving unbidden, which is a different thing. `Book.spellOfTheDay` is already the read, so the work is a decision rather than plumbing: does a notification draw its own spell, or carry the one the widget is showing? Carrying it costs nothing and keeps the day coherent. Drawing its own means either a notification that spends a draw against a screen you never unlocked, or a second kind of draw that doesn't count — and a `drawn` number that means two things is worse than no number.
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

## Widget cadence

The turn is currently once a day at midnight,
and `save()` also refreshes the rendered widget on every book change — not by
re-rolling a new day, but by re-reading `spellOfTheDay()` for today, which can
land on a *different* spell mid-day if the pool it draws from changed (a tag
edited, a spell buried, a weight tuned). That reads as the widget re-rolling on
a whim, when what actually moved was the input, not the pick.

Two changes are on the table, and they're separable:

1. **Turn more than once a day** — every couple of hours rather than only at
   midnight. Needs a period number in place of `dayNumber()`, and the
   no-repeat window (currently 7 real days, seeded by a 21-day warm-up walk)
   rescaled to periods rather than days.
2. **Stop turning on save.** If a save should no longer be able to change
   *which* spell is showing — only the clock should — then
   `SpellbookBridge.save()` can't just call `SpellWidget.refresh()` and trust
   `spellOfTheDay()` to reproduce the same answer, because it might not (see
   above). Two ways to hold that line: keep `refresh()` on save but make the
   pick itself immune to pool changes within a period (fiddly, since "derived,
   never stored" is the whole reason the widget can't race the WebView's
   save); or stop calling `refresh()` from save entirely and let only the
   periodic alarm turn the widget over, accepting that an edit to the
   currently-shown spell won't reach the home screen until the next period
   boundary.

Open: the period length (a couple of hours is the instinct, not yet a number),
and which of the two "stop turning on save" approaches to take — they trade a
slightly stale home screen against keeping the derived-not-stored guarantee

## Per-screen filters

Right now there is exactly one sticky filter (`S.include` / `S.require` /
`S.exclude`), and the draw, the library and Vault → The draw → **Filters** all
read and write the same one — `openFilters()` is the one sheet, opened from
three places. The widget doesn't apply it at all (see "Weights yes, filters
no", above) — deliberately, but that leaves no way to ask for a *narrower*
home screen without also narrowing the draw and the book.

**The proposal:** three independent sticky filters instead of one — draw,
book (library), and widget. Each screen keeps, or gets, its own inline filter
chip to edit its own filter in place; the Vault's standalone **Filters** item
goes away for draw and book, since editing in context replaces the reason it
existed. The widget has no screen of its own to hold a chip, so its filter
stays configurable from the Vault — the one case where the Vault keeps a
Filters entry.

Open: whether the widget's filter, once it exists, composes with or replaces
its existing weights (`inboxWeight`/`flaggedWeight`) — those aren't going
anywhere, this is additive; and what the default is for a book that's never
set a widget filter (presumably: none, same as today).
## The shelf — shipped

Built as a third value of `state` rather than as a tag, which is the question
this spec left open. The argument, and what it cost, is in
`decisions/0009-the-shelf-is-a-state.md`.

## Desk amounts and history

Today the desk (`s.desked`, a single timestamp) only tells you what's on it
*right now*: fresh for `DESK_DAYS` (3), fading for another `DECAY_DAYS` (3),
then `deskState()` returns `null` and the spell quietly stops appearing
anywhere — the desk screen, the "Desk" row on the detail sheet — with no
record it was ever there. Re-pinning overwrites the one timestamp, so a spell
pinned five times over a year looks the same as one pinned once.

Two related asks:

- **Amounts** — how many times has this spell been pinned, total? A counter
  next to `desked`, incremented on every desk action, the same shape as
  `useful`/`drawn`.
- **History** — a record of past desk stays, not just the current one. The
  notes array's shape (`{id, type, text, createdAt}`) already generalises to
  this — a `{type:'desked', createdAt}` entry per pin would give a thread of
  desk history for free, on the same mechanism that already carries voice
  notes without restructuring (see "Text notes on a spell", above) — rather
  than a new array shape.

Open: whether history should log every pin, or only pins that survive long
enough to matter (a re-pin within the fresh window arguably isn't a new
"visit").
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

# The rest of the hygiene backlog

None of these are urgent, and none are wrong — they're untidy. Kept here rather
than in the refactor plan so there's one place to look.

- **45 inline `style="…"` attributes in template literals**, now around 39. The
  ones carrying real meaning — the on/off state toggles — became
  `.tagbtn.picked` and `.factitem .nm.required` / `.never`. The rest are layout
  nudges, and the design system in `:root` is still only half-honoured.
- **A stylelint pass over `css/app.css`.** The duplicate-`@keyframes` assertion
  in the smoke suite is a stand-in for a real linter, and it only catches the
  one thing it was written for.
- **The no-repeat window is in-memory only.** `recent`, capped at `S.noRepeat`
  (default 12), is a plain array that resets on every launch, so "no repeat in
  the last 12" holds within a session and not across one. The widget's version
  of the same idea doesn't have this gap — it reconstructs three weeks
  deterministically instead of remembering anything.
- **The rest of the file split**, if a section starts to feel too big. `vault`
  (7.2 KB) and `card` (6.4 KB) are the next candidates and can each be lifted
  on their own. The one piece that isn't a straight cut is `window.onNative` in
  `js/voice.js`, which handles `backup`, `open` and `notify` as well as `voice`;
  splitting it means a `js/native.js` owning the inbound half of the bridge next
  to `js/store.js`, which owns the outbound half.
## Someday — spellbooks in a room together

Low priority, genuinely fun, unspecified. Playing with other people's books at events, across the iOS/Android gap, without a server.

**Exchange** is the easy half: a QR code carries a spell or a small set, readable by any camera. No app, no network, no pairing.

**Games** need shared state. The trick that fits: one phone hosts a small web server over the venue wifi and everyone else joins by opening a URL. No iOS app, because there is no app — the host's phone is the venue. The architecture already suits this, since the whole thing is a web page.

Ideas, unfiltered: spells drawn against each other with the room voting on which lands harder; drawing from a stranger's book; a shared draw where everyone gets the same spell and says what it means to them.