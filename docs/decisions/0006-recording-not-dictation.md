# 6. A recording, not a transcript

**Status:** accepted · shipped · superseded in part by nothing; see decision 2

## Decision

A spoken note is stored as audio. Speech-to-text was rejected.

## Why

Speech-to-text was the cheaper feature by a wide margin — no new storage shape,
no backup problem, notes stay searchable. It was rejected because on-device
recognition fails exactly where this feature is used: half-formed thoughts,
feeling rather than information, words invented on the spot. **A bad transcript
of something you said while shaken is worse than no note at all.**

Recording doesn't foreclose transcription. If the djinn arrives, a recording
can be transcribed later — per note, opt-in, by a model that's actually good at
it.

## Consequences

- Voice notes aren't searchable. Accepted.
- Audio needs somewhere to live and something to carry it offsite: decisions 1
  and 3.
- The mechanics of actually capturing it — the headset, the profile switch, the
  route that moves under a note — are decision 2, and they are the expensive
  part.
