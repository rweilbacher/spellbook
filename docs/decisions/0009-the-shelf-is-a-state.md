# 9. The shelf is a state, not a tag

**Status:** accepted · shipped

## Decision

`shelved` is a third value of `s.state`, alongside `active` and `graveyard`.
It is not a tag, which is how `inbox` and `flagged` are modelled and what
`decisions/0005` set the precedent for.

## Why

The shelf answers a question the graveyard was being made to answer badly:
*this is a real spell and I don't want it in front of me this year.* Burying
says the spell doesn't work. Flagging says it might not be good enough and
still leaves it in the draw, down-weighted. Neither of those is what a spell
you're setting down for a season needs, and using the graveyard for both means
every trip there is a re-litigation of two different questions at once.

`decisions/0005` argued the inbox into being a tag, and the argument was
right for the inbox: a tag arrives with rename, delete, the tag index and
Require/Never filtering already built. The shelf inherits that argument and
comes out the other way, for one reason. **A shelved spell has to be out of
the draw, the book, the desk and the widget by construction.** As a tag that
is four separate exclusions to write and remember — `pool()`, the library,
`deskList()`, and `Book.spellOfTheDay()` in Kotlin — every one of them a place
a later change can forget. As a state it is one line, `active()`, which all
four already read, and the widget's Kotlin already skips anything whose
`state` isn't `"active"` — so the shelf needed no Kotlin at all.

The second reason is what a tag can have done to it. Tags are deletable by
design; that is most of why they're pleasant. Deleting `shelved` in the tag
manager would silently return the whole shelf to the draw, which is precisely
the surprise you set those spells down to avoid. `PROTECTED` exists for this
and would have covered it, but a protected tag is a tag with its best property
removed, and at that point it is a state wearing a tag's clothes.

## Consequences

- `SCHEMA` moves to 4 with **no migration**. There is no field to fix: every
  spell in an existing book is already `active` or `graveyard`, and an empty
  shelf is what an unshelved book correctly looks like. The number moves
  anyway, because an older build maps an unknown state back to `active` and
  would quietly empty the shelf — the stamp is the only place that fact can
  be written down.
- Shelving is not filterable, unlike `flagged`. There is no Require/Never for
  it and no row in the Filters sheet, because the shelf is a place you go
  rather than a property you narrow the book by. If that turns out to be
  wrong, the fix is a filter over the pile, not a tag.
- **Shelving strips `inbox`.** It is deliberate contact with the spell, the
  same as marking it useful or flagging it — you have looked at it and made a
  call. It comes back off the shelf on its own merits, not still queued as
  unread.
- Merge leaves `state` alone, so no incoming file can take a spell off your
  shelf, exactly as none can resurrect a buried one. Restore replaces it, as
  it replaces everything.
- The graveyard and the shelf are the same screen — the library, showing a
  different pile. `libPile` holds which one, and `PILES` holds what each is
  called and what its empty state says. A fourth disposition would be a row
  in that table rather than a fourth branch in five places.
- Two of the seed's spells are shelved, so a first run has a shelf with
  something in it and the smoke test has a fixture for a state that is
  neither active nor buried.

## What this doesn't settle

Whether a shelved spell should ever surface on its own — an *exhume* for the
shelf, the way the roadmap wants one for the graveyard. The shelf is the
gentler pile, so a spell resurfacing from it after a year is a better idea
there than in the graveyard, and the mechanism would be the same. Not built.
