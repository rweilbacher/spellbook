/* Spellbook · relay/room.js
   One circle: who is in it, and which spells are lying in it. Nothing else.

   Pure logic with no transport in it. Two thin shells drive it — worker.js
   (a Cloudflare Durable Object, the real relay) and tools/relay.mjs (Node,
   for the smoke suite and for working at a desk) — so the code the tests run
   is the code the phones talk to.

   A connection is anything with send(string) and close(code, reason). The
   shell calls connect() when a socket opens, receive() for each message,
   disconnect() when it closes, and sweep() every so often.

   What this deliberately is not: a store. Nothing here is written anywhere.
   The phones are the record — each one remembers what it laid down and lays
   it down again after a reconnect — so a room that is lost (a deploy, an
   eviction, everyone's screen going dark at once) can always be rebuilt by
   the people in it. See the circle spec in docs/roadmap.md.

   The protocol, client → room:
     hello   {name, token?, host?}   first message on every socket
     approve {id} · refuse {id}      the host letting someone in, or not
     lay     {key, text, tags}       put one of your spells in the circle
     pickup  {key}                   take one of yours back out
     take    {id}                    you copied someone's spell into your book
     heart   {id}                    this one landed (toggles)
     leave · close · ping
   room → client:
     welcome {you:{id, token, host}} · waiting · refused · closed
     state   {you, members, knocks, laid}    after every change, to everyone
     error   {code}                          taken · nohost · full · bad · limit
     pong */

export const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;   // no 0/O, no 1/I
export const LIMITS = {
  members: 8,            // a circle, not a crowd
  laidEach: 60,          // per person, at once
  text: 4000,            // the longest real spell is well under this
  tags: 16, tag: 40, name: 24,
  message: 16384,        // bytes; anything bigger is not a spell
  graceMs: 5 * 60 * 1000 // how long a dropped seat is kept
};

const rand = n => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
};
const str = (x, max) => (typeof x === 'string' && x.trim() && x.length <= max) ? x.trim() : null;

export class Room {
  constructor(opt = {}){
    this.now = opt.now || Date.now;
    this.members = new Map();   // id → {id, name, color, host, approved, token, conn, awaySince}
    this.laid = new Map();      // id → {id, key, owner, text, tags, takenBy:Set, hearts:Set, at}
    this.conns = new Map();     // conn → member id, or null before hello
    this.colors = 0;
  }

  /* ---------- the shell's four calls ---------- */

  connect(conn){ this.conns.set(conn, null); }

  receive(conn, raw){
    if(!this.conns.has(conn)) return;
    if(typeof raw !== 'string' || raw.length > LIMITS.message) return this.error(conn, 'bad');
    let m;
    try{ m = JSON.parse(raw); }catch(e){ return this.error(conn, 'bad'); }
    if(!m || typeof m.t !== 'string') return this.error(conn, 'bad');
    if(m.t === 'ping') return this.send(conn, { t:'pong' });
    if(m.t === 'hello') return this.hello(conn, m);

    const me = this.members.get(this.conns.get(conn));
    if(!me) return this.error(conn, 'bad');
    if(m.t === 'leave') return this.leave(me);
    if(!me.approved) return;                      // waiting at the door: nothing else counts
    switch(m.t){
      case 'approve': return this.approve(me, m.id, true);
      case 'refuse':  return this.approve(me, m.id, false);
      case 'lay':     return this.lay(me, m);
      case 'pickup':  return this.pickup(me, m.key);
      case 'take':    return this.mark(me, m.id, 'takenBy');
      case 'heart':   return this.mark(me, m.id, 'hearts', true);
      case 'close':   return me.host ? this.closeAll() : undefined;
    }
  }

  disconnect(conn){
    const id = this.conns.get(conn);
    this.conns.delete(conn);
    const me = id && this.members.get(id);
    if(!me || me.conn !== conn) return;           // a replaced socket going quietly
    me.conn = null;
    if(!me.approved){ this.members.delete(id); this.broadcast(); return; }
    // The seat and what's on it wait: a phone's screen going dark drops the
    // socket, and that is not the same as leaving.
    me.awaySince = this.now();
    this.broadcast();
  }

  sweep(){
    const t = this.now();
    for(const me of [...this.members.values()]){
      if(me.conn || me.awaySince == null || t - me.awaySince < LIMITS.graceMs) continue;
      if(me.host){ this.closeAll(); return; }
      this.drop(me);
      this.broadcast();
    }
  }

  get idle(){ return this.conns.size === 0; }

  /* ---------- arriving ---------- */

  hello(conn, m){
    if(this.conns.get(conn)) return;              // one hello per socket
    const name = str(m.name, LIMITS.name);
    const back = typeof m.token === 'string' && [...this.members.values()].find(x => x.token === m.token);
    if(back){
      // The same person on a new socket. The old one, if it is somehow still
      // open, is closed rather than left to answer for them.
      if(back.conn){ this.conns.delete(back.conn); try{ back.conn.close(4000, 'replaced'); }catch(e){} }
      back.conn = conn; back.awaySince = null;
      this.conns.set(conn, back.id);
      if(back.approved) this.send(conn, { t:'welcome', you:{ id:back.id, token:back.token, host:back.host } });
      else this.send(conn, { t:'waiting' });
      this.broadcast();
      return;
    }
    if(!name) return this.error(conn, 'bad');
    const host = this.hostMember();
    if(m.host){
      if(host) return this.error(conn, 'taken');  // the code is in use; the page picks another
      this.add(conn, name, true);
      return;
    }
    if(!host) return this.error(conn, 'nohost');
    if(this.members.size >= LIMITS.members) return this.error(conn, 'full');
    this.add(conn, name, false);
  }

  add(conn, name, host){
    const me = { id:'m' + rand(4), name, color:this.colors++ % 8, host, approved:host,
                 token:rand(16), conn, awaySince:null };
    this.members.set(me.id, me);
    this.conns.set(conn, me.id);
    if(host) this.send(conn, { t:'welcome', you:{ id:me.id, token:me.token, host:true } });
    else this.send(conn, { t:'waiting' });
    this.broadcast();
  }

  approve(me, id, yes){
    const them = this.members.get(id);
    if(!me.host || !them || them.approved) return;
    if(yes){
      them.approved = true;
      if(them.conn) this.send(them.conn, { t:'welcome', you:{ id:them.id, token:them.token, host:false } });
    } else {
      if(them.conn){ this.send(them.conn, { t:'refused' }); this.conns.delete(them.conn); try{ them.conn.close(4001, 'refused'); }catch(e){} }
      this.members.delete(id);
    }
    this.broadcast();
  }

  /* ---------- the spells ---------- */

  lay(me, m){
    const key = str(m.key, 40), text = str(m.text, LIMITS.text);
    if(!key || !text) return this.error(me.conn, 'bad');
    const tags = Array.isArray(m.tags)
      ? m.tags.filter(t => str(t, LIMITS.tag)).slice(0, LIMITS.tags) : [];
    const id = me.id + '.' + key;
    const had = this.laid.get(id);
    if(!had && this.mine(me).length >= LIMITS.laidEach) return this.error(me.conn, 'limit');
    // Laying down a key that's already there is a re-announce after a
    // reconnect: the text may have been edited meanwhile, the history stays.
    this.laid.set(id, { id, key, owner:me.id, text, tags,
      takenBy: had ? had.takenBy : new Set(), hearts: had ? had.hearts : new Set(),
      at: had ? had.at : this.now() });
    this.broadcast();
  }

  pickup(me, key){
    if(this.laid.delete(me.id + '.' + key)) this.broadcast();
  }

  mark(me, id, field, toggle){
    const s = this.laid.get(id);
    if(!s || s.owner === me.id) return;           // not your own spell
    if(toggle && s[field].has(me.id)) s[field].delete(me.id);
    else s[field].add(me.id);
    this.broadcast();
  }

  /* ---------- going ---------- */

  // The host leaving closes the circle: there would be nobody left to open
  // the door, and a circle that outlives its host is a stranger's room.
  leave(me){
    if(me.host) return this.closeAll();
    const conn = me.conn;
    this.drop(me);
    if(conn){ this.conns.delete(conn); try{ conn.close(1000, 'left'); }catch(e){} }
    this.broadcast();
  }

  drop(me){
    this.members.delete(me.id);
    for(const [id, s] of this.laid) if(s.owner === me.id) this.laid.delete(id);
    for(const s of this.laid.values()){ s.takenBy.delete(me.id); s.hearts.delete(me.id); }
  }

  closeAll(){
    for(const conn of [...this.conns.keys()]){
      this.send(conn, { t:'closed' });
      try{ conn.close(1000, 'closed'); }catch(e){}
    }
    this.conns.clear();
    this.members.clear();
    this.laid.clear();
  }

  /* ---------- telling people ---------- */

  hostMember(){ return [...this.members.values()].find(x => x.host) || null; }
  mine(me){ return [...this.laid.values()].filter(s => s.owner === me.id); }

  stateFor(me){
    const members = [...this.members.values()].filter(x => x.approved).map(x => ({
      id:x.id, name:x.name, color:x.color, host:x.host, present:!!x.conn }));
    const knocks = me.host
      ? [...this.members.values()].filter(x => !x.approved && x.conn).map(x => ({ id:x.id, name:x.name }))
      : [];
    const laid = [...this.laid.values()].sort((a, b) => b.at - a.at).map(s => ({
      id:s.id, key:s.key, owner:s.owner, text:s.text, tags:s.tags,
      takenBy:[...s.takenBy], hearts:[...s.hearts] }));
    return { t:'state', you:me.id, members, knocks, laid };
  }

  broadcast(){
    for(const me of this.members.values())
      if(me.conn && me.approved) this.send(me.conn, this.stateFor(me));
  }

  send(conn, obj){ try{ conn.send(JSON.stringify(obj)); }catch(e){} }
  error(conn, code){ if(conn) this.send(conn, { t:'error', code }); }
}
