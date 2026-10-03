/* Spellbook · relay/worker.js
   The real relay: a Cloudflare Worker that hands each circle to its own
   Durable Object, which holds one Room (room.js) in memory.

     wss://<this worker>/c/K7QX

   No hibernation, on purpose. A hibernating object loses its memory, and
   memory is the only place a circle lives; the free plan's duration
   allowance covers about a day of open circles per day anyway. Nothing is
   written to the object's storage — it is declared SQLite-backed only
   because that is the kind the free plan offers.

   Deploy: `npx wrangler deploy` from this folder, or the Relay workflow. */

import { Room, CODE_RE } from './room.js';

export default {
  async fetch(req, env){
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/c\/([A-Z0-9]{4})$/);
    if(!m) return new Response('spellbook relay\n', { status: url.pathname === '/' ? 200 : 404 });
    if(!CODE_RE.test(m[1])) return new Response('bad code\n', { status: 400 });
    if(req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only\n', { status: 426 });
    return env.CIRCLES.get(env.CIRCLES.idFromName(m[1])).fetch(req);
  }
};

export class Circle {
  constructor(){
    this.room = new Room();
    this.timer = null;
  }

  async fetch(){
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const conn = {
      send: s => server.send(s),
      close: (code, reason) => server.close(code, reason)
    };
    this.room.connect(conn);
    server.addEventListener('message', e =>
      this.room.receive(conn, typeof e.data === 'string' ? e.data : ''));
    const gone = () => { this.room.disconnect(conn); this.tick(); };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    this.tick();
    return new Response(null, { status: 101, webSocket: client });
  }

  // A seat kept for a dropped phone has to expire even if nobody says
  // anything, so the room is swept on a timer while anyone is connected.
  tick(){
    if(this.room.idle){ clearInterval(this.timer); this.timer = null; return; }
    if(!this.timer) this.timer = setInterval(() => { this.room.sweep(); this.tick(); }, 30000);
  }
}
