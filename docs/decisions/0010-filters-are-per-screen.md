# 10. Filters are per screen

**Status:** accepted · shipped

## Decision

There is no longer one sticky filter. The draw, the book (the library) and the
home screen widget each have their own, held in `settings.filters`:

```json
"filters": {
  "draw":   { "include": [], "require": [], "exclude": [] },
  "book":   { "include": [], "require": [], "exclude": [] },
  "widget": { "include": [], "require": [], "exclude": [] }
}
```

Each is the same three lists the shared one was, with the same rule — include
ORs, require ANDs, exclude vetoes, and the three combine with AND. Only *which
filter* is the caller's business now: `matchesFilters(s, f)` takes it, and
`pool(scope)` picks it.

The draw and the book are edited where they are: the filter chip on the draw
screen opens `openFilters('draw')`, the one in the library opens
`openFilters('book')`. The Vault's standalone **Filters** item is gone, because
editing in context is what it existed to avoid. The widget has no screen to hold
a chip, so the Vault keeps one entry, **The widget → Widget filter**.

## Why

The shared filter answered "where am I?" for one screen and was then applied to
all of them. Narrowing the library to `flagged` to review things quietly
narrowed the next draw; setting the draw to `spiralling` for a bad hour left the
book showing a fraction of itself. The two screens ask different questions, and
the widget — which `decisions/0007` kept out of it entirely, correctly — had no
way to be narrowed at all without narrowing everything else.

## What came with it

- **The widget now has a filter, and `0007`'s "filters no" is half-undone.** The
  draw's and the book's still don't reach it; that was the right call and
  stays. What changes is that the widget has a standing instruction of its own,
  set deliberately, from the Vault, and never inherited from where you last
  browsed. Its default is none, which is what it did before. The filter
  **composes with the weights** rather than replacing them: it narrows the pool,
  and `inboxWeight` / `flaggedWeight` choose within it.
- **The widget had to learn the computed tags.** `question`, `untagged` and
  `useful` are derived in `computed()` and never stored, so a widget that read
  only stored tags could honour a filter on `practice` and silently ignore one
  on `useful`. `SpellWidget.kt` now mirrors `computed()` — and `untagged`
  needs `isSituationLike()`, which needs the default situation list and
  `tagKindOverrides` too. That is two new rows on the duplication register
  (#9 and #10 in `bridge.md`), a deliberate price: the alternative was a widget
  filter that could not do what the other two can.
- **Anything that follows a tag follows it through all three.** Rename, delete
  and change-of-kind in the tag manager, and `syncTagVocabulary()`, go through
  `eachFilter()`. A fourth scope would be picked up by all of them by adding a
  name to `SCOPES`. Missing one is the old stranded-filter bug of `0008` again,
  three times over.
- **A card's brass tags follow the screen it is on.** `isActiveFilter()` asks
  `viewScope()`: the book's filter while the library is showing (its detail
  sheets open over it), the draw's anywhere else.

## Consequences

- `SCHEMA` moves to 5, with a migration: `migrateFilterScopes()`. The old flat
  `include` / `require` / `exclude` seed both the draw's and the book's
  filter, so the first launch after the update looks like the last one before
  it; the widget's starts empty. The flat lists are then deleted from settings —
  two sources of truth for one filter is what the migration exists to end.
- Unlike the other migrations it carries no version gate. It states an
  invariant the app leans on everywhere — `S.filters` exists, all three scopes,
  three arrays each — so it is guarded by that, and it also repairs a file that
  claims v5 without it. `adoptSettings()` deliberately does *not* default
  `S.filters`: its absence is how the migration knows the file is old.
- An older build opening a v5 book reads no `include` / `require` / `exclude`,
  starts with empty filters, and on its next save re-stamps the file v4. The
  next new build finds `S.filters` still there beside the stray lists, drops the
  lists, and carries on. Nothing is lost except filter edits made in the older
  build.
- Changing the widget's filter changes its pool, and the pick is derived from
  the pool, so the home screen will usually land on a different spell straight
  away — the "reads as a re-roll" behaviour already described under *Widget
  cadence* in `../roadmap.md`, now with a reason a person causes on purpose.
  It is not solved here.
- A restore brings all three filters back. A merge ignores settings, as ever.
