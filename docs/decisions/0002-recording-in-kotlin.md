# 2. Voice recording is native Kotlin, not the web layer

**Status:** accepted · shipped

## Decision

`startVoiceNote()` / `stopVoiceNote()` / `cancelVoiceNote()` on the bridge.
Kotlin owns the recorder and writes the file; the page is told only
`{file, duration}` when it's done, with elapsed time and input level pushed
back a few times a second so the UI has something alive to show.

## Why

**Not dictation.** Speech-to-text was the cheaper feature by a wide margin — no
new storage shape, no backup problem, notes stay searchable — and it was
rejected because on-device recognition fails exactly where this feature is
used: half-formed thoughts, feeling rather than information, words invented on
the spot. A bad transcript of something you said while shaken is worse than no
note at all. Recording also doesn't foreclose transcription — if the djinn
arrives, a recording can be transcribed later, per note, opt-in, by a model
that's actually good at it.

**Recording is native Kotlin, not the web layer.** The page could have asked
the browser engine for the microphone and shipped the audio back across the
bridge, which would have kept everything in `index.html` and kept working in
desktop preview. It was rejected for one reason: the web API gives you whatever
input device the system considers default, with no say in the matter, and the
headset requirement below makes that disqualifying. Handing off to the system
recorder app was rejected too — it throws you out of the app mid-thought, and
it's the app whose Bluetooth behaviour prompted this in the first place.

So: `startVoiceNote()` / `stopVoiceNote()` / `cancelVoiceNote()` on the bridge,
Kotlin owns the recorder and writes the file, and the page is told only
`{file, duration}` when it's done. Progress — elapsed time and input level —
is pushed back into the page a few times a second so the UI has something
alive to show. The consequence to accept: **no voice notes in desktop preview.**
The mic button simply isn't rendered when there's no bridge, the same way the
storage banner already admits what preview can't do.

**Bluetooth first, knowingly.** When a headset is connected, record through it.
Google Recorder ignoring the headset isn't a bug on their part — a classic
Bluetooth headset mic is a telephone-grade link, 8–16kHz, plainly worse than
the phone's own microphone, and a recorder app is right to prefer fidelity. But
this isn't a recorder app. A voice note gets spoken quietly, hands busy, earbuds
already in, and convenience beats fidelity every time at that moment. Phones and
headsets that both speak LE Audio get proper quality anyway, for free, with
nothing to build.

Practically: bring the link up, wait for it, *then* start capturing, or the
first second or two is lost. If it hasn't connected within about two seconds,
fall back to the built-in mic and say so rather than failing. A toggle in the
Vault turns the preference off for the one time you care how it sounds.

**What a headset actually costs, learned the hard way.** A classic Bluetooth
headset is two devices wearing one name — Windows shows this honestly, listing
an XM4 twice, once as *Stereo* and once as *Hands-free*. Stereo (A2DP) is
high-quality, one direction, no microphone. Hands-free (HFP) is bidirectional
and telephone-grade. The radio can't do both, so the instant anything asks for
the mic the headset drops out of stereo and into call mode — for the whole
phone, not just for us. That switch is the source of every rough edge here:

- *Silence at the front of a note.* Android reporting the device as selected is
  not the same as the link carrying audio. Starting the encoder on that signal
  records the changeover. Fixed by settling for ~450ms after routing confirms.
- *A note with a hole in the middle.* Three candidates, all now closed.
  `VOICE_COMMUNICATION` — the obvious audio source for a call-routed mic —
  applies echo cancellation, automatic gain and noise suppression tuned for
  telephony, and gates quiet speech as noise; `VOICE_RECOGNITION` routes the
  same way without the processing. A notification played through A2DP mid-note
  forces a profile renegotiation and drops the capture, so recording now takes
  exclusive audio focus. And a screen that times out mid-note both triggers our
  own save-on-pause and hits Android's rule that a backgrounded app gets a
  muted microphone, so the screen is held on for the length of a note.
- *The headset behaving differently while recording* — ambient sound coming
  through, ANC changing — is the profile switch. It is also the tell: **if that
  doesn't happen, the headset is not the microphone.** Selecting the device
  with `setCommunicationDevice` is not sufficient on its own; the framework
  only raises the call link when a communication use case is actually in
  progress, and in `MODE_NORMAL` there isn't one. The device reads back as
  selected, the headset stays in stereo, and capture comes off the phone's own
  microphone while the UI cheerfully claims otherwise. `MODE_IN_COMMUNICATION`
  for the length of the recording is what makes it real — and it has to be put
  back afterwards, because it is a whole-phone state.

**The recorder says which microphone it is using, and means it.** Asking for a
device and getting it are different questions, and the first version answered
the first one while appearing to answer the second. `getRoutedDevice()` on the
running recorder is the ground truth; it's polled alongside the level meter and
named on screen — *the headset*, *the phone's microphone* — so a note recorded
on the wrong input is visible while it happens rather than on playback. Polling
rather than reading it once also catches a route that moves out from under a
note halfway through, which is one of the ways a recording ends up with a hole
in it.

The screen-on flag is the proportionate fix, not the correct one. The correct
one is a foreground service with a microphone type, which is what would let a
note keep recording with the screen off. Worth it only if notes start getting
long enough that holding the screen is the thing that feels wrong.

**Where the audio lives.** `files/media/`, one AAC file per note, filename on
the note. Never base64 in the book: at ~100KB the JSON is rewritten on every
single edit, and a megabyte of audio in there would make every keystroke
expensive. The media directory is served over the same internal `https://`
origin the app already uses for its assets, so playback is an ordinary
`<audio>` tag and nothing has to loosen file access. Seeking within a note may
not work — the asset loader doesn't answer range requests — which is fine at
this length and would be the reason to change approach if notes ever got long.

**The export stays JSON, and stays honest about it.** `Export the book`
continues to write one JSON file with no audio in it. A restored book therefore
has voice notes whose recordings are gone, and those render as
*recording lost* rather than a broken player. The offsite copy of the audio is
the backup folder's job (decision 3) — that's the split: the export is the portable
book, the backup folder is the complete one.

**Housekeeping is real work and easy to forget.** Deleting a note deletes its
file. A book loaded on a phone that has files nothing refers to sweeps them on
boot. Both go through the bridge with the filename validated against a strict
pattern first — the web layer must never be able to name a path.

**Open:** whether a voice note should ever be transcribed into a text note it
sits beside, or whether the recording alone is the artefact. Deferred until the
djinn exists and there's something to try it with.

## Consequences

**No voice notes in desktop preview.** The mic button simply isn't rendered
when there's no bridge, the same way the storage banner already admits what
preview can't do.
