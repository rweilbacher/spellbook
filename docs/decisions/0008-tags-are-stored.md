# 0008 — The tag vocabulary is stored

**Status:** accepted, 2026-08-29. Shipped with schema 3.

## The problem

`allTags()` built the tag list by counting tags across active spells. A tag
with no members therefore did not exist: retag the last spell wearing it, or
bury it, and the tag stopped rendering everywhere — the Filters sheet, the tag
manager, the editor's tag grid, all three of which read that one function.

Filter state does not work that way. `S.include` / `S.require` / `S.exclude`
hold names, they persist between sessions, and nothing checked whether the
name still had members. So the two could disagree, and when they did:

1. Require `inbox`, to work through what's untested.
2. Work through it. Marking a spell useful strips `inbox`; so does flagging
   it, and so does burying it.
3. The last one leaves. The row vanishes from the Filters sheet.
4. `S.require` still says `inbox`. `pool()` is empty, the draw says "Nothing
   matches those filters", the book says the same — and there is no longer a
   control anywhere on screen to turn it off.

The only way out was **Clear all filters**, which also discards every other
situation and Require/Never that was set. The chip label still read
"needs inbox", so the app could say what was wrong without letting you fix it.

`inbox` is where this was noticed because emptying the inbox is the *point* —
but nothing about it is specific to `inbox`. Any tag reaching zero did this.

## The decision

`doc.tags` — an array of tag names — is part of the book. `allTags()` reads
it and attaches a count, so a tag sits at 0 rather than disappearing. Deleting
a tag in the tag manager is the only thing that removes an entry.

This is a deliberate exception to **"derived properties are never stored"**
(`docs/design.md`). The principle exists so that an edit can't leave a stale
value behind, and it holds for computed tags, desk decay and the widget's
pick — all of which are *functions of the spells*. The vocabulary isn't one.
A tag with no members is real, and carries state that points at it; the
derived version had no way to express that, which is precisely the bug. The
count stays derived, which is the part the principle was protecting.

`STRUCTURAL` — `question`, `untagged`, `useful` — stays computed and never
enters the vocabulary. They are seeded into `allTags()` at 0 instead, for the
same reason: `untagged` reaching zero is the good outcome, and it must not
strand a filter set on it.

## What follows from it

- **`syncTagVocabulary()` states an invariant, not a one-shot.** The
  vocabulary is a superset of what is in use: every tag any spell wears
  (buried ones too — they come back), plus anything the filters or the kind
  overrides still point at. It runs as the v3 migration, ungated by version
  because `doc.tags` is load-bearing enough that a book claiming v3 without
  one should be repaired rather than rendered empty. Running it at boot is
  also what unsticks a filter left on an already-emptied tag from before this
  shipped.
- **Delete has to clear all four places at once** — the spells, the three
  filter lists, the kind override — or the next `syncTagVocabulary()` would
  put the tag back from whichever one still pointed at it. That is what makes
  the invariant idempotent rather than a resurrection machine.
- **`inbox` joins `flagged` in `PROTECTED`.** The app writes both itself, so
  a book without them is a book the app immediately recreates them in, under
  a name nothing else refers to. It was already true of `flagged`; `inbox`
  being deletable was an oversight. (`inboxSeeded` guards the retroactive
  pass, which is a different question — that's about not re-tagging spells,
  not about the tag existing.)
- **A tag typed in the editor is created on save**, not on Enter, so a tag
  typed and then thought better of doesn't outlive a cancelled edit.
- **The vocabulary travels with the book.** It's in an export and comes back
  from a restore, empty categories included. A **merge** learns only the tags
  arriving on the spells: folding someone's spells in isn't a hand-over of
  their filing system, and their unused tags would land here as rows at 0
  with nothing behind them.

## What was considered instead

- **Keep a tag only while something points at it** — union the counted list
  with `S.include`/`require`/`exclude`. No schema change, and it closes the
  trap exactly. Rejected because it makes a tag's existence depend on whether
  it happens to be filtered on, which is a stranger rule than "tags stay
  until you delete one", and it doesn't give you the tag back after you clear
  the filter.
- **`S.knownTags`, in settings**, beside `tagKindOverrides`. Cheaper — merge
  and export ignore settings. Rejected because tags are authored content, and
  restoring a book on another phone would have brought the spells but not the
  vocabulary that describes them.
