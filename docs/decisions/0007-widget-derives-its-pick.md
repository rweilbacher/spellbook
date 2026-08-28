# 7. The widget derives its pick and never writes

**Status:** accepted · shipped · cadence still open, see `../roadmap.md`

## Decision

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

## Consequences

- The widget can never race the WebView's save, because it has nothing to save.
- Nothing to migrate, ever: the pick is a function of the day and the book.
- A save refreshing the widget can land on a *different* spell mid-day if the
  pool changed underneath it — the input moved, not the pick, but it reads as a
  re-roll. That is the open cadence question in `../roadmap.md`.
- Open: whether a long-press should offer a re-roll.
