# Roadmap

What's next, and the specs for the things big enough to need thinking through
before they're built. Anything here that has shipped has moved to
`CHANGELOG.md`, and the reasoning behind it to `decisions/`.

## Next

- **Useful weight.** A third dial in the Vault's draw options beside Inbox weight and Flagged weight: `S.usefulWeight`, default 1 (no effect), a multiplier in `weightOf` for spells carrying the `useful` tag. Combines multiplicatively with the other two, same as they do with each other.
- **Widget cadence.** Turning more than once a day, and no longer turning on save. Spec below.
- **Desk amounts and history.** Spec below.
- **A faster way to clear filters in the library.** Today, clearing an active Require/Never/Situation filter means opening the Filters sheet and tapping "Clear all filters" — the tag and pile chips next to it (`#clearTag`, `#clearPile`) already carry their own inline ✕, the filter chip (`#libFilterChip`) doesn't. An ✕ there when a filter is active, or a small clear control beside the sort chip, would match the pattern already on screen.
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

**Exchange is specced below as *The circle*** — over a relay rather than without a server, for the reasons given there.

---

# Specs

## Widget cadence

The turn is currently once a day at midnight,
and `save()` also refreshes the rendered widget on every book change — not by
re-rolling a new day, but by re-reading `spellOfTheDay()` for today, which can
land on a *different* spell mid-day if the pool it draws from changed (a tag
edited, a spell buried, a weight tuned). That reads as the widget re-rolling on
a whim, when what actually moved was the input, not the pick.

Editing the widget's own filter (`decisions/0010`) is now the commonest way to
move that pool, and it re-rolls the pick on the spot for the same reason.

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

## Per-screen filters — shipped

Draw, book and widget each have their own sticky filter, in `settings.filters`.
The draw and the book are edited from their own screens; the Vault keeps one
Filters entry, for the widget. The widget's filter composes with its weights
rather than replacing them, and defaults to none. The widget's Kotlin had to
learn the computed tags to honour it — `decisions/0010`.

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

## The circle

The exchange half of *spellbooks in a room together*. Two or more people with
the app open a shared space, lay spells down in it, and take copies of each
other's into their own books. Same room or different cities, the same thing.

**This breaks "without a server", deliberately.** Every serverless shape was
weighed. QR codes are one-way and a few spells at a time. A phone hosting its
own server means a Kotlin web server and a foreground service, and works only
on wifi that lets phones see each other, which venue wifi usually doesn't.
WebRTC is peer to peer until a carrier's NAT says otherwise, and then it needs
a relay anyway. A relay that keeps nothing is the honest version of that
fallback, used from the start.

### The relay

A Cloudflare Worker and one Durable Object per circle, in `relay/` beside
`app/` and deployed by an Actions workflow the way the APK is built. Plain JS,
no build step on our side. Everything fits in the free plan by orders of
magnitude: an evening's session is a few hundred WebSocket messages, billed at
20:1, against 100,000 requests a day.

**No hibernation.** A hibernating Durable Object is cheaper and forgets its
memory, and memory is the only place a circle lives. Awake, a circle is billed
for duration — and the free plan's 13,000 GB-s a day is about a day of open
circles, every day. The circle logic is one pure file, `relay/room.js`, which
`tools/relay.mjs` also runs locally for the smoke suite.

- **It holds the room and nothing else.** Who is present, and which spells are
  lying in the circle. In memory only — nothing is written to storage, and a
  circle is gone when its last person leaves. **The phones are the record:**
  each one remembers what it laid down and lays it down again whenever it's
  let back in, so a room lost to a deploy or an eviction is rebuilt by the
  people in it.
- **It sees spell text in the clear**, the way the djinn's API call would. A
  typed code can't carry a key, and a short code isn't worth deriving one from.
  Stated plainly in the Vault, same as the djinn.
- **A seat is kept for five minutes after a drop.** The WebView is paused when
  the screen sleeps and the socket goes with it; your seat, what you laid
  down and your open book wait for you to come back, keyed by a token the page
  holds in memory.
- **Two quiet hours close a circle.** Pings keep sockets alive, so a phone left
  open on a table would keep a circle awake — and billed for duration — for
  ever. Anything but a ping counts as activity; two hours without any and the
  relay closes the circle and says why.

### The page side

The socket lives in JavaScript, not Kotlin. There's no key to protect and no
CORS for a WebSocket, so nothing argues for the shell — and keeping it in the
page means **the circle works in preview mode**: two desktop tabs can sit in
one circle, and `smoke.mjs` can drive exactly that against a Node copy of the
room logic. The shell's only change is the `INTERNET` permission, if it isn't
already declared.

### A session

1. **Open a circle.** The host gets a five-character code drawn from the
   eighteen letters and digits that look most like runes — straight strokes,
   no curves: `F H K M N R T X Y Z A B L P V W 4 7`. No 0/O or 1/I to confuse,
   by construction. They read it out or send it.
2. **Join.** A guest types the code (any case) and a display name, and is in.
   **The code is the key**; there was a door the host had to open, and it was
   ceremony nobody wanted. Five characters from eighteen is nearly two million
   codes — enough that stumbling on a live one isn't a plan. The name is a
   setting, asked for once.
3. **Lay down, pick up, take.** Anyone can lay a spell down; only its owner can
   pick it up. Anyone else can take it.
4. **Closing.** Three ways, and only three:
   - **The host closes it** — or leaves, which is the same thing: it was theirs
     to open, and a circle that outlives its host is a stranger's room.
   - **The host drops and doesn't come back** within the five-minute seat.
   - **Two quiet hours** — see the relay, above.
   A guest leaving, or dropping past their five minutes, takes their spells and
   their open book with them and leaves the circle as it was.

### What crosses the wire

A laid-down spell carries its **text** and its **filing tags**, and nothing
else. `inbox` and `flagged` stay home: they say how a spell is doing for you,
not how it's filed. Not
its notes or recordings, not `useful` or `drawn`, not its pile or its desk, not
its `source` — which can carry Obsidian paths and URLs. **No counts at all**,
not even as a signal of how well a spell has worked for its owner.

The tags travel so you can **see how someone files a spell**, and that is all
they do. They render on the card in the plain style, never brass, since brass
means *you asked for this* (`design.md`).

### Taking a spell

Not `mergeSpells`. That path is for your own book arriving from another phone:
it matches on id, overwrites text and tags, and brings notes across — voice
notes included, whose audio would never arrive. Taking gets its own, smaller
path:

- **A fresh id.** The giver's id means nothing in your book.
- **The text, and no tags.** Their vocabulary is theirs; a taken spell arrives
  `untagged` plus `inbox`, which is what *unproven* means, and gets filed by
  you in triage like anything else.
- **Where it came from goes in `source`**:
  `{origin:'circle', note:'from Ana', capturedAt:'2026-10-03', …}`, with the
  other fields `null`. The source panel learns one label, *From the circle*,
  and shows the name and the date. An older build shows the raw origin, which
  is fine: no schema bump, no migration.
- **Taking twice is a no-op.** The card says *in your book* once its text is
  already there, matched on the trimmed text rather than an id — the same spell
  from two different friends is still one spell.

### Opening your book

A switch in the circle, not in the Vault: **your book is closed** until you
open it, and it closes itself when you leave. A standing "my book is
searchable" setting is exactly the thing you'd forget was on.

**Opening it is full access**, and that includes your filters. What goes:

- the **words and filing tags of every active spell** — the shelf and the
  graveyard never, and dark spells, when they exist, out by construction;
- the **names of your situations**, so a visitor's `untagged` means what yours
  does;
- your **draw and book filters**, so a visitor can look through your book the
  way you do.

Still not: counts, notes, recordings, sources, `inbox` or `flagged` — and so
not `useful` either, which is a count. Filters lose those tags on the way out.

This **reverses the first version of this spec**, which had the visitor's
query forwarded to your phone so the relay never held a book. Full access with
your filters wants the whole book on the visitor's side, where their own
filtering can run on it; so the book is sent once when you open it, and again a
moment after any save while it's open. The relay holds it in memory, like
everything else, and forgets it when you close it or leave.

Looking through someone's book is a **sheet over the circle screen**, not the
library: their spells, a search, their draw and book filters as one-tap
presets, and their tags as chips — situations OR'd, the rest AND'd, as in your
own filter sheet. **Take** works as it does on a laid-down card, and the owner
hears that someone took from their book.

### The screen

Entered from the Vault, under **Together**. A sixth tab, **Circle**, appears in
the nav while there is one and goes when it ends, so the bar is five tabs on
every day there isn't.

One shared table rather than a trade window. A trade window's two panes and
double confirm exist to protect something scarce, and giving a spell costs
nothing; two panes also stop fitting a phone at three people.

- Every card carries a small initial in its owner's colour; a chip row filters
  to one person.
- Someone else's card: **Take** and a heart (*this landed*). Your own: **Pick
  up**, and who took it.
- **Being taken from is never missable.** A toast and a buzz wherever you are;
  a mark on the Circle tab until you look; and a *Taken from you* list at the
  top of the circle screen — who, which spell, from the table or from your
  open book, and when — for as long as the circle lasts.
- **Lay down from your book** opens a picker built from the library list, with
  a search and **its own sticky filter**, `settings.filters.lay` — a fourth
  scope, by the same reasoning as `decisions/0010`. The detail sheet gets *Lay
  down in the circle* while a session is live. **No eighth icon on the card's
  action row** — it's already overdue for more room.

### In order

1. The relay, the circle, laying down, taking into the inbox — **built**, with
   hearts brought forward because they cost a line. Being tried phone to
   browser before it's called shipped.
2. Opening your book and browsing someone else's — **built**, together with
   the code-is-the-key change and the lay-down filter.
3. The games, from the Someday list above.

### Open

- **Friends on iPhone.** The circle itself doesn't care what's on the other
  end of the socket, but a book does. The cheap route is the page as a home-
  screen web app with a browser storage backend — no widget, no chosen
  microphone, reminders only via web push. A native shell is a Swift rewrite of
  the six Kotlin files, a WidgetKit widget, an async bridge, and a paid
  developer account to install it at all. Neither is part of this spec.
- **The name.** *The circle*, *lay down*, *take*, *pick up* are being tried
  on, not settled.

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
