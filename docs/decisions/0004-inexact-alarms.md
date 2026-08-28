# 4. Inexact alarms, allowed while idle

**Status:** accepted · shipped · applies to both the widget's midnight turn and
the daily reminders

## Decision

`setAndAllowWhileIdle` on an inexact alarm, one per reminder slot plus one for
the widget's turn. Re-armed after each fire, on every launch, and on the four
broadcasts that invalidate an alarm: boot, app update, clock change, timezone
change.

## Why

`updatePeriodMillis` — the widget framework's own schedule — can't go below
thirty minutes and doesn't fire while the phone sleeps. Wrong on both counts
for a thing that changes once a day.

An exact alarm would land on the second, and costs the `SCHEDULE_EXACT_ALARM`
permission Android 12 put behind its own prompt. An inexact one costs one wake
a day, needs no prompt at all, and lands within a few minutes.

**A reminder is not a stopwatch.** A nudge set for 09:00 arriving at 09:04 when
the phone is dozing is not a defect. Neither is a widget that turns over a few
minutes after midnight.

## Consequences

- No exact-alarm permission prompt, ever.
- A few minutes of drift, by design, stated in the README.
- Re-arming on a save happens only when the times actually changed, compared
  against a stored signature — the book is written on every edit and the times
  change about twice a year.
