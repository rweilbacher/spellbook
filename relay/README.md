# The relay

The circle's server, and all of it: `room.js` is one circle (who's in it,
what's laid down), `worker.js` puts each circle in its own Cloudflare
Durable Object. Nothing is stored. The spec is *The circle* in
`docs/roadmap.md`.

## Deploying it

Once, from this folder, on your own machine:

```bash
npx wrangler login      # opens a browser; a free Cloudflare account is enough
npx wrangler deploy
```

The last line it prints is the relay's address, something like
`https://spellbook-relay.<your-subdomain>.workers.dev`. Tell the app: **The
circle → Relay → Change**, paste it as it is, and *Test the connection*. It is
saved in the book's settings, so it survives restarts and updates. To make it
the default for a fresh install too, put it in `RELAY_URL` at the top of
`app/src/main/assets/js/circle.js`, with `wss://` in place of `https://`.

After that, pushes that touch `relay/` deploy it through the Relay workflow,
if the repo has two secrets: `CLOUDFLARE_API_TOKEN` (create one from the
"Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID` (on the
dashboard's Workers page). Without them the workflow says so and does
nothing. Deploying from this folder by hand works just as well.

It runs on the free plan with room to spare: 100,000 requests a day, and an
evening's circle is a few dozen of them.

## Running it locally

`node tools/relay.mjs` runs the same `room.js` behind a plain WebSocket
server on port 8787, which is what the smoke suite uses. Open
`index.html?relay=ws://localhost:8787` in two browser windows for a circle
at your desk. The phone can't reach it — the app is served over https, and
Android won't let it open a plain `ws://` socket — so a phone always uses the
deployed relay.
