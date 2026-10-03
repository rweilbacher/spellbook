/**
 * The circle's relay, on your own machine.
 *
 * The same Room (relay/room.js) the Cloudflare relay runs, behind a plain
 * WebSocket server, so the smoke suite and a desk session can have a circle
 * without the internet.
 *
 *   node tools/relay.mjs            listens on 8787
 *   then open index.html?relay=ws://localhost:8787 in two browser windows
 *
 * The app inside the Android shell can't use this one: it is served over
 * https, and Android won't let it talk to a plain ws:// server. The phone
 * needs the deployed relay.
 */
import { WebSocketServer } from 'ws';
import { Room, CODE_RE } from '../relay/room.js';
import { fileURLToPath } from 'node:url';

export function startRelay({ port = 0, now } = {}){
  const rooms = new Map();
  const wss = new WebSocketServer({ port });
  wss.on('connection', (ws, req) => {
    const code = (req.url || '').replace(/^\/c\//, '');
    if(!CODE_RE.test(code)){ ws.close(1008, 'bad code'); return; }
    let room = rooms.get(code);
    if(!room){ room = new Room({ now }); rooms.set(code, room); }
    const conn = { send: s => ws.send(s), close: (c, r) => ws.close(c, r) };
    room.connect(conn);
    ws.on('message', d => room.receive(conn, d.toString()));
    ws.on('close', () => { room.disconnect(conn); if(room.idle && !room.members.size) rooms.delete(code); });
  });
  const timer = setInterval(() => rooms.forEach(r => r.sweep()), 30000);
  timer.unref();
  return new Promise(res => wss.on('listening', () => res({
    port: wss.address().port, rooms,
    close: () => new Promise(r => { clearInterval(timer); wss.close(r); for(const c of wss.clients) c.terminate(); })
  })));
}

if(process.argv[1] === fileURLToPath(import.meta.url)){
  const port = Number(process.argv[2]) || 8787;
  const r = await startRelay({ port });
  console.log(`relay listening on ws://localhost:${r.port}`);
}
