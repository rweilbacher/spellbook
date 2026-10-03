/* Spellbook · relay/room.js
   One circle: who is in it, which spells are lying in it, and the books its
   people have opened to it. Nothing else.

   Pure logic with no transport in it. Two thin shells drive it — worker.js
   (a Cloudflare Durable Object, the real relay) and tools/relay.mjs (Node,
   for the smoke suite and for working at a desk) — so the code the tests run
   is the code the phones talk to.

   A connection is anything with send(string) and close(code, reason). The
   shell calls connect() when a socket opens, receive() for each message,
   disconnect() when it closes, and sweep() every so often.

   What this deliberately is not: a store. Nothing here is written anywhere.
   The phones are the record — each one remembers what it laid down and
   whether its book is open, and says so again after a reconnect — so a room
   that is lost (a deploy, an eviction, everyone's screen going dark at once)
   can always be rebuilt by the people in it. See the circle spec in
   docs/roadmap.md.

   The code is the key. Anyone who has it is in; there is no door to knock
   on. The page makes codes long enough that guessing one isn't a plan.

   The protocol, client → room:
     hello   {name, token?, host?}   first message on every socket
     lay     {key, text, tags}       put one of your spells in the circle
     pickup  {key}                   take one of yours back out
     take    {id}                    you copied someone's laid spell
     heart   {id}                    this one landed (toggles)
     book    {book}                  open your book to the circle; null closes it
     tookbook {owner, id}            you copied a spell out of someone's open book
     leave · close · ping
   room → client:
     welcome {you:{id, token, host}} · closed {why?}
     state   {you, members, laid}            after every change, to everyone
     book    {owner, book}                   someone's open book, or null when it closes
     tookbook {by, id}                       to the owner only
     error   {code}                          taken · nohost · full · bad · limit · big
     pong */

export const CODE_RE = /^[A-Z0-9]{4,6}$/;
export const LIMITS = {
  members: 8,              // a circle, not a crowd
  laidEach: 60,            // per person, at once
  text: 4000,              // the longest real spell is well under this
  tags: 16, tag: 40, name: 24,
  message: 16384,          // bytes; anything bigger is not a spell
  book: 900000,            // an opened book: ~150 spells is 30KB, so this is a ceiling, not a target
  bookSpells: 2000,
  graceMs: 5 * 60 * 1000,  // how long a dropped seat is kept
  idleMs: 2 * 60 * 60 * 1000 // a circle nobody has done anything in for this long closes
};

const rand = n => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
};
const str = (x, max) => (typeof x === 'string' && x.trim() && x.length <= max) ? x.trim() : null;
const strs = (a, max, n) => Array.isArray(a) ? a.filter(t => str(t, max)).slice(0, n) : [];

export class Room {
  constructor(opt = {}){
    this.now = opt.now || Date.now;
    this.members = new Map();   // id → {id, name, color, host, token, conn, awaySince}
    this.laid = new Map();      // id → {id, key, owner, text, tags, takenBy:Set, hearts:Set, at}
    this.books = new Map();     // member id → their opened book, as they sent it (cleaned)
    this.conns = new Map();     // conn → member id, or null before hello
    this.colors = 0;
    this.active = this.now();   // the last time anyone did anything but ping
  }

  /* ---------- the shell's four calls ---------- */

  connect(conn){ this.conns.set(conn, null); }

  receive(conn, raw){
    if(!this.conns.has(conn)) return;
    if(typeof raw !== 'string' || raw.length > LIMITS.book) return this.error(conn, 'big');
    let m;
    try{ m = JSON.parse(raw); }catch(e){ return this.error(conn, 'bad'); }
    if(!m || typeof m.t !== 'string') return this.error(conn, 'bad');
    if(m.t !== 'book' && raw.length > LIMITS.message) return this.error(conn, 'bad');
    if(m.t === 'ping') return this.send(conn, { t:'pong' });
    this.active = this.now();
    if(m.t === 'hello') return this.hello(conn, m);

    const me = this.members.get(this.conns.get(conn));
    if(!me) return this.error(conn, 'bad');
    switch(m.t){
      case 'leave':    return this.leave(me);
      case 'lay':      return this.lay(me, m);
      case 'pickup':   return this.pickup(me, m.key);
      case 'take':     return this.mark(me, m.id, 'takenBy');
      case 'heart':    return this.mark(me, m.id, 'hearts', true);
      case 'book':     return this.book(me, m.book);
      case 'tookbook': return this.tookBook(me, m);
      case 'close':    return me.host ? this.closeAll() : undefined;
    }
  }

  disconnect(conn){
    const id = this.conns.get(conn);
    this.conns.delete(conn);
    const me = id && this.members.get(id);
    if(!me || me.conn !== conn) return;           // a replaced socket going quietly
    // The seat, what's on it and the open book all wait: a phone's screen
    // going dark drops the socket, and that is not the same as leaving.
    me.conn = null;
    me.awaySince = this.now();
    this.broadcast();
  }

  sweep(){
    const t = this.now();
    if(this.members.size && t - this.active > LIMITS.idleMs){ this.closeAll('idle'); return; }
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
    const back = typeof m.token === 'string' && [...this.members.values()].find(x => x.token === m.token);
    if(back){
      // The same person on a new socket. The old one, if it is somehow still
      // open, is closed rather than left to answer for them.
      if(back.conn){ this.conns.delete(back.conn); try{ back.conn.close(4000, 'replaced'); }catch(e){} }
      back.conn = conn; back.awaySince = null;
      this.conns.set(conn, back.id);
      this.welcome(back);
      this.broadcast();
      return;
    }
    const name = str(m.name, LIMITS.name);
    if(!name) return this.error(conn, 'bad');
    const host = this.hostMember();
    if(m.host){
      if(host) return this.error(conn, 'taken');  // the code is in use; the page picks another
    } else {
      if(!host) return this.error(conn, 'nohost');
      if(this.members.size >= LIMITS.members) return this.error(conn, 'full');
    }
    const me = { id:'m' + rand(4), name, color:this.colors++ % 8, host:!!m.host,
                 token:rand(16), conn, awaySince:null };
    this.members.set(me.id, me);
    this.conns.set(conn, me.id);
    this.welcome(me);
    this.broadcast();
  }

  // Who you are, and every book already open to the circle.
  welcome(me){
    this.send(me.conn, { t:'welcome', you:{ id:me.id, token:me.token, host:me.host } });
    for(const [owner, book] of this.books)
      if(owner !== me.id) this.send(me.conn, { t:'book', owner, book });
  }

  /* ---------- the spells ---------- */

  lay(me, m){
    const key = str(m.key, 40), text = str(m.text, LIMITS.text);
    if(!key || !text) return this.error(me.conn, 'bad');
    const tags = strs(m.tags, LIMITS.tag, LIMITS.tags);
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

  /* ---------- open books ----------
     A whole book, opened to the circle by its owner: the words and filing
     tags of its active spells, the names of its situations, and the owner's
     own draw and book filters, so a visitor can look through it the way its
     owner does. Cleaned on the way in, held in memory, gone the moment the
     owner closes it or leaves. */

  book(me, b){
    if(b == null){
      if(this.books.delete(me.id)) this.tellBook(me.id, null);
      return;
    }
    if(typeof b !== 'object' || !Array.isArray(b.spells)) return this.error(me.conn, 'bad');
    const filter = f => (f && typeof f === 'object') ? {
      include: strs(f.include, LIMITS.tag, 200), require: strs(f.require, LIMITS.tag, 200),
      exclude: strs(f.exclude, LIMITS.tag, 200) } : null;
    const clean = {
      spells: b.spells.slice(0, LIMITS.bookSpells).map(s => s && {
        id: str(s.id, 40), text: str(s.text, LIMITS.text), tags: strs(s.tags, LIMITS.tag, LIMITS.tags)
      }).filter(s => s && s.id && s.text),
      situations: strs(b.situations, LIMITS.tag, 500),
      tags: strs(b.tags, LIMITS.tag, 500),
      filters: { draw: filter(b.filters && b.filters.draw), book: filter(b.filters && b.filters.book) }
    };
    this.books.set(me.id, clean);
    this.tellBook(me.id, clean);
  }

  tellBook(owner, book){
    for(const m of this.members.values())
      if(m.id !== owner && m.conn) this.send(m.conn, { t:'book', owner, book });
    this.broadcast();                             // members carry who has a book open
  }

  // Said to the owner alone: someone took a copy of one of yours.
  tookBook(me, m){
    const owner = this.members.get(m.owner);
    const id = str(m.id, 40);
    if(!owner || owner === me || !id || !this.books.has(owner.id)) return;
    if(owner.conn) this.send(owner.conn, { t:'tookbook', by:me.id, id });
  }

  /* ---------- going ---------- */

  // The host leaving closes the circle: it was theirs to open, and a circle
  // that outlives its host is a stranger's room.
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
    if(this.books.delete(me.id)) this.tellBook(me.id, null);
  }

  closeAll(why){
    for(const conn of [...this.conns.keys()]){
      this.send(conn, why ? { t:'closed', why } : { t:'closed' });
      try{ conn.close(1000, 'closed'); }catch(e){}
    }
    this.conns.clear();
    this.members.clear();
    this.laid.clear();
    this.books.clear();
  }

  /* ---------- telling people ---------- */

  hostMember(){ return [...this.members.values()].find(x => x.host) || null; }
  mine(me){ return [...this.laid.values()].filter(s => s.owner === me.id); }

  stateFor(me){
    const members = [...this.members.values()].map(x => ({
      id:x.id, name:x.name, color:x.color, host:x.host, present:!!x.conn, open:this.books.has(x.id) }));
    const laid = [...this.laid.values()].sort((a, b) => b.at - a.at).map(s => ({
      id:s.id, key:s.key, owner:s.owner, text:s.text, tags:s.tags,
      takenBy:[...s.takenBy], hearts:[...s.hearts] }));
    return { t:'state', you:me.id, members, laid };
  }

  broadcast(){
    for(const me of this.members.values())
      if(me.conn) this.send(me.conn, this.stateFor(me));
  }

  send(conn, obj){ try{ conn.send(JSON.stringify(obj)); }catch(e){} }
  error(conn, code){ if(conn) this.send(conn, { t:'error', code }); }
}
