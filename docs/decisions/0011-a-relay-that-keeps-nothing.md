# 11. A relay that keeps nothing, and a socket in the page

**Status:** accepted · built, being tried phone to browser

## Decision

The circle runs through a relay on Cloudflare: a Worker, one Durable Object
per circle, holding who is present and which spells are laid down, in memory
and nowhere else. The phone opens the socket from JavaScript, not from Kotlin.
The circle's logic is one pure file, `relay/room.js`, run by the Worker in
production and by `tools/relay.mjs` locally.

## Why

**Not without a server**, which is what the roadmap first hoped for. A phone
hosting the room needs a Kotlin web server and a foreground service, and works
only on wifi that lets phones see each other — venue wifi usually doesn't. QR
codes are one-way, a few spells at a time. WebRTC is peer to peer until a
carrier's NAT refuses, and then it needs a relay anyway. A relay that keeps
nothing is that fallback, used from the start, and it works the same with
two people in one room or in two cities.

**Not hibernating.** A hibernating Durable Object costs less and forgets its
memory, and memory is where the circle is. The free plan's duration allowance
covers about a day of awake circles every day, which is more than this app
will ever use.

**The phones are the record.** Each one remembers what it laid down and lays it
down again whenever it's let back in. So the relay can lose a room — a deploy,
an eviction — without anyone losing anything but a moment, and there is still
nothing to store.

**The socket in the page.** The djinn's HTTPS call belongs in Kotlin because it
carries a key and would meet CORS. A WebSocket to the relay has neither problem.
Keeping it in the page keeps the Kotlin to one manifest line, and means the
circle works in preview mode: a phone and a desktop browser can share a
circle, which is how it is tested by hand, and two Playwright pages can share
one, which is how the suite tests it.

**One room, two shells.** The Worker and the local relay are each forty-odd
lines around the same `Room`, so the code the suite exercises is the code the
phones talk to.

## Consequences

- Cloudflare sees a laid-down spell's words in the clear. Said plainly on the
  circle screen, the way the djinn's spec says it of Anthropic.
- The relay deploys separately from the APK (`relay/README.md`). Its address is
  a constant in `js/circle.js`, set once after the first deploy.
- The phone can't use the local relay: the app is served over https and Android
  won't open a plain `ws://` socket from it. Desk testing is browser to browser
  locally, or phone to browser through the deployed relay.
- The app now holds the `INTERNET` permission. Nothing but the circle uses it.
