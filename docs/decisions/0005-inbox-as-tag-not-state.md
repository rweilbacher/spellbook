# 5. The inbox is a tag, not a third state

**Status:** accepted · shipped · precedent for the shelf, which is still open

## Decision

`inbox` is an ordinary authored tag, not a third value of `state` alongside
`active` and `graveyard`, which is how it was first sketched.

## Why

The threshold for adding a spell should be near zero, but a spell that just arrived hasn't earned anything. The inbox reconciles those.

- Shipped as a tag (`inbox`), not the third `state` this was first sketched as — simpler, and it comes with tag management (rename, remove) and Require/Never filtering for free, the same as `practice`/`prompt`/`flagged`. New spells — written by hand, imported — land here; migrated once, retroactively, over everything already in the book that wasn't already marked useful.
- **Preferential treatment means more exposure, not more trust.** Over-represented in the draw by a weight set directly in Vault → The draw (`inboxWeight`, default 3×), rather than a fixed multiplier.
- Visibly marked as untested when drawn, so a miss reads as *this one didn't work* rather than *the book is noisy*.
- Promotion by use: one `useful` mark strips the tag. Demotion is the ordinary bury — a buried spell keeps `inbox` (and its weight, if it's ever exhumed) rather than losing it on the way to the graveyard. Can also be removed by hand, same as any authored tag.
- Capture is still the write-a-spell sheet and import; one tap from anywhere still means the Android share target, still queued.

**Open:** does an inbox spell need tagging before it can be drawn, or is it drawn untagged and tagged only if it survives? Unaffected by the tag-vs-state choice above — still open. Leaning towards the latter — tagging something you're about to bury is wasted effort.
A tag comes with tag management (rename, remove), Require/Never filtering and
the tag index for free, the same as `practice` / `prompt` / `flagged`. A third
`state` would have needed each of those built specially, and `state` is the
field that decides whether a spell is in the book at all — a heavier thing to
overload than it looks.

## Consequences

- Promotion by use: one `useful` mark strips the tag. Demotion is the ordinary
  bury, and a buried spell keeps `inbox` rather than losing it on the way to the
  graveyard.
- The retroactive pass over an existing book had to be gated on a doc-level flag
  (`inboxSeeded`) rather than tag presence, because a tag removed by hand must
  not come back on the next boot.
- **The shelf inherits this argument but not its conclusion.** A shelved spell
  probably shouldn't be drawn or widgeted at all by default, which a plain tag
  doesn't give you — it would have to be built into `pool()` and
  `Book.spellOfTheDay()` directly, the way `state !== 'active'` already is. See
  `../roadmap.md`.
