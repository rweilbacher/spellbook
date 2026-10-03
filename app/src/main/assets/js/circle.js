/* Spellbook · circle.js
   The circle: two or more books in a room together. Lay spells down, take
   copies of each other's into your own book, and open your whole book to
   the circle if you like. The spec is "The circle" in docs/roadmap.md; the
   relay, and the protocol, are in relay/room.js.
   Loaded by index.html before the inline script. Plain script, shared
   globals — no imports, no build step. Order does not matter among these.

   The socket lives here, in the page, not in Kotlin. There is no key to
   keep out of the web layer and no CORS for a WebSocket, and keeping it here
   means the circle works in preview mode too — a phone and a desktop browser
   can sit in the same circle, which is how it gets tested by hand.

   What leaves the phone, and only while you are in a circle:
     · a spell you lay down — its words and filing tags
     · your book, if you open it — the words and filing tags of its active
       spells, the names of its situations, and your draw and book filters
     · the name you give
   Nothing else — not notes, recordings, counts, the shelf or the graveyard,
   or anyone's source. inbox and flagged stay home too: they are marks about
   how a spell is doing for you, not how it's filed.

   Nothing is opened at boot. No circle, no socket. */

/* Where the relay lives, unless the circle screen's Relay setting
   (S.relayUrl) says otherwise — that's the one to change after a deploy,
   no new APK needed. In preview mode ?relay=ws://localhost:8787 points the
   page at tools/relay.mjs and beats both. */
const RELAY_URL = 'wss://spellbook-relay.rweilbacher.workers.dev';

/* Codes are drawn from the letters and digits that look most like runes —
   straight strokes, no curves — and are five long. The code is the only key
   to a circle now, so it wants to be long enough not to stumble on: 18⁵ is
   nearly two million. No 0/O or 1/I to confuse, by construction. */
const RUNE_CHARS = 'FHKMNRTXYZABLPVW47';
const CODE_LEN = 5;
const CIRCLE_CODE_RE = /^[A-Z0-9]{4,6}$/;    // what the relay accepts; the page makes fives
const RETRY_S = [1, 2, 4, 8, 15, 30];
const GIVE_UP_MS = 6 * 60 * 1000;   // a little past the relay's five-minute seat
/* Functions, not constants: INBOX and the rest are declared by the inline
   script, which runs after this file. */
const keptHome = () => [INBOX, FLAGGED];
const notShared = () => [INBOX, FLAGGED, 'useful'];   // useful needs counts, which stay home

/* The whole client state. `phase` is one of
     idle · connecting · live · away
   `away` is live with the socket down: the seat is held for us, and we keep
   trying to get back to it. */
const C = {
  phase:'idle', code:'', host:false, token:null, me:null,
  st:null,                 // the last state the relay sent
  laid:new Map(),          // key → spell id: what this phone has laid down
  bookOpen:false,          // whether this phone's book is open to the circle
  books:new Map(),         // member id → their open book, as the relay passed it on
  browse:null,             // {owner, filter, q}: the last book you looked through, and how
  ws:null, retry:0, retryTimer:null, ping:null, awaySince:0, tries:0, heard:0, saveTimer:null,
  view:'all',              // whose laid spells the screen is showing
  seenTakes:new Set(),
  taken:[],                // {who, color, text, from:'circle'|'book', at}: what's been taken from you, newest first
  news:false               // something was taken while you were elsewhere in the book
};

function relayBase(){
  if(!Bridge){
    const q = new URLSearchParams(location.search).get('relay');
    if(q) return q.replace(/\/+$/, '');
  }
  return cleanRelay(S.relayUrl) || RELAY_URL;
}
/* Whatever was pasted — the https:// address wrangler printed, a bare host,
   a wss:// URL with a path on it — as the scheme and host a socket wants.
   '' when it isn't an address at all. */
function cleanRelay(v){
  let s = (v || '').trim();
  if(!s) return '';
  if(!/^[a-z]+:\/\//i.test(s)) s = 'wss://' + s;
  s = s.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
  try{
    const u = new URL(s);
    return /^wss?:$/.test(u.protocol) && u.host ? u.protocol + '//' + u.host : '';
  }catch(e){ return ''; }
}
function relayLabel(base){ return (base || relayBase()).replace(/^wss?:\/\//, ''); }

/* Can a socket be opened to it at all? Opens one to a throwaway code and
   closes it again without saying hello, which the relay treats as nothing. */
function testRelay(base){
  return new Promise(res => {
    let ws, done = false;
    const fin = ok => { if(done) return; done = true; clearTimeout(t); if(ok) try{ ws.close(); }catch(e){} res(ok); };
    const t = setTimeout(() => fin(false), 8000);
    try{ ws = new WebSocket(`${base}/c/${newCode()}`); }catch(e){ fin(false); return; }
    ws.onopen = () => fin(true);
    ws.onerror = () => fin(false);
  });
}
function newCode(){
  const b = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(b);
  return [...b].map(x => RUNE_CHARS[x % RUNE_CHARS.length]).join('');
}
function circleLive(){ return C.phase === 'live' || C.phase === 'away'; }

/* ---------- the connection ---------- */

function circleStart(host, code){
  const name = (S.circleName || '').trim();
  if(!name){ toast('Give yourself a name first'); return; }
  Object.assign(C, { host, code: host ? newCode() : code, token:null, me:null, st:null,
    view:'all', tries:0, retry:0, bookOpen:false, browse:null });
  C.laid.clear(); C.books.clear(); C.seenTakes.clear(); C.taken = []; C.news = false;
  C.phase = 'connecting';
  circleConnect();
  circleRefresh();
}

function circleConnect(){
  clearTimeout(C.retryTimer); C.retryTimer = null;
  if(C.ws){ const old = C.ws; C.ws = null; try{ old.close(); }catch(e){} }
  let ws;
  try{ ws = new WebSocket(`${relayBase()}/c/${C.code}`); }
  catch(e){ circleEnd(`Couldn't reach the relay at ${relayLabel()}`); return; }
  C.ws = ws;
  ws.onopen = () => {
    if(ws !== C.ws) return;
    C.heard = Date.now();
    circleSend({ t:'hello', name:(S.circleName || '').trim(), token:C.token, host:C.host });
    clearInterval(C.ping);
    // The relay answers every ping, so a minute of silence means the socket
    // is dead even if it still says it's open.
    C.ping = setInterval(() => {
      if(Date.now() - C.heard > 60000) circleKick(); else circleSend({ t:'ping' });
    }, 25000);
  };
  ws.onmessage = e => { if(ws === C.ws){ C.heard = Date.now(); circleHandle(e.data); } };
  ws.onclose = () => { if(ws === C.ws) circleDropped(); };
}

function circleSend(obj){
  if(C.ws && C.ws.readyState === 1) C.ws.send(JSON.stringify(obj));
}

/* The socket went away without anyone saying goodbye. Before we were ever
   in there is nothing to get back to; after, the relay holds the seat and we
   keep knocking on the same token. */
function circleDropped(){
  clearInterval(C.ping); C.ping = null;
  C.ws = null;
  if(C.phase === 'idle') return;
  if(!C.token){ circleEnd(`Couldn't reach the relay at ${relayLabel()}`); return; }
  if(C.phase !== 'away'){ C.phase = 'away'; C.awaySince = Date.now(); circleRefresh(); }
  if(Date.now() - C.awaySince > GIVE_UP_MS){ circleEnd('Lost the circle'); return; }
  const wait = RETRY_S[Math.min(C.retry++, RETRY_S.length - 1)] * 1000;
  C.retryTimer = setTimeout(circleConnect, wait);
}

/* Give up on a socket that has stopped answering, and go back for the seat. */
function circleKick(){
  const ws = C.ws;
  if(!ws) return;
  C.ws = null;
  try{ ws.close(); }catch(e){}
  circleDropped();
}

/* Android freezes an app that's been in the background a while. Coming back,
   the socket may be gone, or worse, look open and be dead. So: reconnect if
   we know it's gone, and if it claims to be open, ask it something and
   believe the answer. */
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState !== 'visible' || C.phase === 'idle') return;
  if(!C.ws){ if(C.phase === 'away') circleConnect(); return; }
  const ws = C.ws, asked = Date.now();
  circleSend({ t:'ping' });
  setTimeout(() => { if(C.ws === ws && C.heard < asked) circleKick(); }, 4000);
});

function circleEnd(msg){
  const ws = C.ws;
  C.ws = null;
  if(ws){ try{ ws.close(); }catch(e){} }
  clearInterval(C.ping); clearTimeout(C.retryTimer); clearTimeout(C.saveTimer);
  C.ping = null; C.retryTimer = null;
  Object.assign(C, { phase:'idle', token:null, me:null, st:null, view:'all', bookOpen:false, browse:null,
    taken:[], news:false });
  C.laid.clear(); C.books.clear();
  if(openSheetName().startsWith('circle')) closeSheet();
  if(msg) toast(msg);
  circleRefresh();
}

function circleHandle(raw){
  let m;
  try{ m = JSON.parse(raw); }catch(e){ return; }
  if(m.t === 'welcome'){
    const first = !C.token;
    C.token = m.you.token; C.me = m.you.id; C.host = m.you.host;
    C.phase = 'live'; C.retry = 0;
    // The phones are the record. Whatever this one had laid down, and its
    // book if it was open, go back to the circle — a no-op if the relay
    // still has them, a rebuild if it doesn't.
    circleResend();
    if(first && !C.host) toast("You're in");
    circleRefresh();
  }
  else if(m.t === 'state'){ circleNotice(m); C.st = m; circleRefresh(); }
  else if(m.t === 'book'){
    if(m.book) C.books.set(m.owner, m.book); else C.books.delete(m.owner);
    if(C.browse && C.browse.owner === m.owner){
      if(!m.book){
        if(['circle-book', 'filters'].includes(openSheetName())) closeSheet();
        C.browse = null;
        toast(`${memberName(m.owner)} closed their book`);
      }
      else renderBookSheet();
    }
    circleRefresh();
  }
  else if(m.t === 'tookbook'){
    const s = doc.spells.find(x => x.id === m.id);
    if(s){ noteTaken(m.by, s.text, 'book'); circleRefresh(); }
  }
  else if(m.t === 'closed'){
    circleEnd(m.why === 'idle' ? 'The circle closed after two quiet hours'
      : C.host ? 'The circle is closed' : 'The host closed the circle');
  }
  else if(m.t === 'error'){
    if(m.code === 'taken' && C.host && !C.token && C.tries++ < 6){
      C.code = newCode(); circleConnect();       // someone has that code; pick another
    }
    else if(m.code === 'nohost') circleEnd(C.token ? 'The circle has closed' : 'No circle with that code');
    else if(m.code === 'full') circleEnd('That circle is full');
    else if(m.code === 'limit') toast("That's as many as you can lay down at once");
    else if(m.code === 'big'){ C.bookOpen = false; toast('Your book is too big to open to the circle'); circleRefresh(); }
    else if(m.code === 'taken') circleEnd("Couldn't open a circle");
  }
}

/* What's worth a word when you're elsewhere in the book: someone arriving,
   someone opening their book, someone taking a spell of yours. Each is said
   once, and nothing in the first state after joining counts as news. */
function circleNotice(st){
  const here = !$('#circle').classList.contains('hide');
  const was = C.st;
  for(const m of st.members){
    if(m.id === C.me || !was) continue;
    const before = was.members.find(x => x.id === m.id);
    if(!before){ if(!here) toast(`${m.name} joined the circle`); buzz(15); }
    else if(m.open && !before.open && !here) toast(`${m.name} opened their book`);
  }
  for(const s of st.laid){
    if(s.owner !== C.me) continue;
    for(const who of s.takenBy){
      const tag = s.id + '>' + who;
      if(C.seenTakes.has(tag)) continue;
      C.seenTakes.add(tag);
      if(was && !was.laid.some(x => x.id === s.id && x.takenBy.includes(who)))
        noteTaken(who, s.text, 'circle', st);
    }
  }
}

/* Someone took a spell of yours. A toast says so wherever you are, and it
   stays written on the circle screen — under "Taken from you" — for as long as
   the circle lasts; the Circle tab carries a mark until you've looked. */
function noteTaken(who, text, from, st){
  const m = (st || C.st) && (st || C.st).members.find(x => x.id === who);
  const name = m ? m.name : memberName(who);
  C.taken.unshift({ who:name, color:m ? m.color : 0, text, from, at:Date.now() });
  toast(`${name} took “${short(text)}”${from === 'book' ? ' from your book' : ''}`);
  buzz([20, 60, 20]);
  if($('#circle').classList.contains('hide')) C.news = true;
}

/* ---------- laying down ---------- */

function layMessage(key, s){
  return { t:'lay', key, text:s.text, tags:s.tags.filter(t => !keptHome().includes(t)) };
}
function laidKey(id){
  for(const [k, v] of C.laid) if(v === id) return k;
  return null;
}
function layDown(s){
  if(!circleLive() || !s || s.state !== ACTIVE || laidKey(s.id)) return;
  const key = 'k' + Math.random().toString(16).slice(2, 10);
  C.laid.set(key, s.id);
  circleSend(layMessage(key, s));
}
function pickUp(id){
  const key = laidKey(id);
  if(!key) return;
  C.laid.delete(key);
  circleSend({ t:'pickup', key });
}

/* Everything this phone has in the circle, said again: after a reconnect,
   and after an edit, so a spell you reworded or buried while it was lying
   down doesn't go on saying the old thing. */
function circleResend(){
  for(const [key, id] of C.laid){
    const s = doc.spells.find(x => x.id === id);
    if(s && s.state === ACTIVE) circleSend(layMessage(key, s));
    else { C.laid.delete(key); circleSend({ t:'pickup', key }); }   // buried or shelved meanwhile
  }
  if(C.bookOpen) sendBook();
}

/* Called by persist() on every save. Nothing to do unless there's a circle;
   when there is, the book's latest state reaches it a moment later — batched,
   because one tap can mean several saves. */
function circleOnSave(){
  if(!circleLive() || (!C.laid.size && !C.bookOpen)) return;
  clearTimeout(C.saveTimer);
  C.saveTimer = setTimeout(circleResend, 1200);
}

/* ---------- opening your book ---------- */

function bookPayload(){
  const hidden = keptHome(), unshared = notShared();
  const strip = f => ({ include:f.include.filter(t => !unshared.includes(t)),
    require:f.require.filter(t => !unshared.includes(t)), exclude:f.exclude.filter(t => !unshared.includes(t)) });
  return {
    spells: active().map(s => ({ id:s.id, text:s.text, tags:s.tags.filter(t => !hidden.includes(t)) })),
    situations: knownTags().filter(t => isSituationLike(t) && !hidden.includes(t)),
    tags: knownTags().filter(t => !hidden.includes(t)),
    filters: { draw:strip(S.filters.draw), book:strip(S.filters.book) }
  };
}
function sendBook(){
  const msg = JSON.stringify({ t:'book', book:bookPayload() });
  if(msg.length > 900000){
    C.bookOpen = false; circleSend({ t:'book', book:null });
    toast('Your book is too big to open to the circle'); circleRefresh();
    return;
  }
  if(C.ws && C.ws.readyState === 1) C.ws.send(msg);
}
function setBookOpen(on){
  if(C.bookOpen === on) return;
  C.bookOpen = on;
  if(on) sendBook(); else circleSend({ t:'book', book:null });
  toast(on ? 'Your book is open to the circle' : 'Your book is closed');
  circleRefresh();
}

/* ---------- taking ---------- */

/* Is this text already in the book, and in which pile? Matched on the words,
   not an id — the same spell from two friends is still one spell, and the
   giver's id means nothing here. */
function normText(t){ return (t || '').replace(/[*=]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); }
function inBook(text){
  const n = normText(text);
  const s = doc.spells.find(x => normText(x.text) === n);
  return s ? s.state : null;
}
const pileWords = p => ({ [ACTIVE]:'In your book', [SHELVED]:'On your shelf', [GRAVEYARD]:'In your graveyard' })[p];

/* Taking a spell — laid down, or out of an open book. Not mergeSpells, which
   is for your own book arriving from another phone: it matches ids,
   overwrites, and carries notes across. This is someone else's line entering
   your book: a fresh id, the words and nothing else, the inbox because it's
   unproven here, and where it came from in the source. No tags: their
   vocabulary is theirs, and you file it yourself in triage. */
function adoptTaken(text, owner){
  text = (text || '').trim();
  if(!text || inBook(text)) return null;
  const s = { id:uid(), text, tags:[INBOX], useful:0, drawn:0, lastDrawn:null,
    state:ACTIVE, desked:null, notes:[], createdAt:now(), updatedAt:now(),
    source:{ origin:'circle', note:'from ' + memberName(owner), file:null, line:null, url:null,
             capturedAt:now().slice(0, 10) } };
  doc.spells.push(s);
  syncTagVocabulary();
  persist();
  buzz(10);
  return s;
}
function takeFromCircle(item){
  const s = adoptTaken(item.text, item.owner);
  if(s) circleSend({ t:'take', id:item.id });
  return s;
}
function takeFromBook(owner, item){
  const s = adoptTaken(item.text, owner);
  if(s) circleSend({ t:'tookbook', owner, id:item.id });
  return s;
}

/* ---------- the screen ---------- */

function memberName(id){
  const m = C.st && C.st.members.find(x => x.id === id);
  return m ? m.name : 'someone';
}
function memberColor(id){
  const m = C.st && C.st.members.find(x => x.id === id);
  return m ? m.color : 0;
}
function short(t){ const p = t.replace(/[*=]/g, '').replace(/\s+/g, ' ').trim(); return p.length > 40 ? p.slice(0, 38) + '…' : p; }
const HEART = `<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.7-7.5-10a4.2 4.2 0 017.5-2.6A4.2 4.2 0 0119.5 10.5c0 5.3-7.5 10-7.5 10z"/></svg>`;
const BOOK_ICON = `<svg viewBox="0 0 24 24"><path d="M4 5.5A1.5 1.5 0 015.5 4H10v16H5.5A1.5 1.5 0 014 18.5z"/><path d="M20 5.5A1.5 1.5 0 0018.5 4H14v16h4.5a1.5 1.5 0 001.5-1.5z"/></svg>`;

/* Called on every change of phase or state: the nav tab exists only while
   there is a circle, and whatever's on screen redraws. */
function circleRefresh(){
  $('#navCircle').classList.toggle('hide', C.phase === 'idle');
  if(!$('#circle').classList.contains('hide')) C.news = false;
  $('#navCircle').classList.toggle('news', C.news);
  if(!$('#circle').classList.contains('hide')) renderCircle();
  if(!$('#vault').classList.contains('hide')) renderVault();
  if(openSheetName() === 'circle-lay') renderLayList();
}

function circleSummary(){
  if(C.phase === 'idle') return 'Open one, or join with a code';
  if(C.phase === 'connecting') return 'Connecting…';
  const n = C.st ? C.st.members.length : 1;
  return `${C.code} · ${n} here${C.phase === 'away' ? ' · reconnecting' : ''}`;
}

function renderCircle(){
  const body = $('#circleBody');
  C.news = false;                                // you're looking now
  $('#navCircle').classList.remove('news');
  $('#circleMeta').textContent = circleLive() ? circleSummary() : '';

  if(C.phase === 'idle'){
    body.innerHTML = `
      <p class="help" style="margin-top:0">Lay spells down for each other and take copies into your own book.
        Nothing in your book is seen until you lay it down, or open it.</p>
      <div class="field"><label for="cName">Your name</label>
        <input id="cName" maxlength="24" autocomplete="off" placeholder="What the circle calls you" value="${esc(S.circleName || '')}"></div>
      <button class="btn" id="cOpen">Open a circle</button>
      <div class="decay-divider"><span>or join one</span></div>
      <div class="field"><label for="cCode">Code</label>
        <input id="cCode" class="ccode-in" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="RFX4K"></div>
      <button class="btn ghost" id="cJoin">Join</button>
      <div class="banner">Anyone with the code is in. Spells travel through a relay that keeps nothing and forgets the
        circle when it ends. Only words and filing tags are sent — never notes, recordings, counts or sources.</div>
      <div class="group"><span class="eyebrow">Relay</span>
        <button class="item" id="cRelay">
          <svg viewBox="0 0 24 24"><path d="M4 12h16"/><circle cx="4" cy="12" r="2"/><circle cx="20" cy="12" r="2"/><path d="M12 7v10"/></svg>
          <span class="lab">${esc(relayLabel())}<span class="s">${S.relayUrl ? 'Set here' : 'The built-in address'}</span></span>
          <span class="val">Change</span></button></div>`;
    const keepName = () => { const v = $('#cName').value.trim().slice(0, 24); if(v !== (S.circleName || '')){ S.circleName = v; persist(); } };
    $('#cName').onchange = keepName;
    $('#cOpen').onclick = () => { keepName(); circleStart(true); };
    $('#cJoin').onclick = () => {
      keepName();
      const code = $('#cCode').value.trim().toUpperCase();
      if(!CIRCLE_CODE_RE.test(code)){ toast('A code is five letters and numbers'); return; }
      circleStart(false, code);
    };
    $('#cCode').oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    $('#cRelay').onclick = openRelaySheet;
    return;
  }

  if(C.phase === 'connecting'){
    body.innerHTML = `
      <div class="ccode">${esc(C.code)}</div>
      <div class="empty" style="padding-top:8px"><b>${C.host ? 'Opening the circle…' : 'Joining…'}</b></div>
      <button class="btn ghost" id="cCancel">Cancel</button>`;
    $('#cCancel').onclick = () => circleEnd();
    return;
  }

  const st = C.st || { members:[], laid:[] };
  const others = st.members.filter(m => m.id !== C.me);
  if(C.view !== 'all' && !st.members.some(m => m.id === C.view)) C.view = 'all';
  const laid = st.laid.filter(s => C.view === 'all' || s.owner === C.view);
  const openBooks = others.filter(m => C.books.has(m.id));

  body.innerHTML = `
    ${C.phase === 'away' ? `<div class="banner" style="margin-top:0">Reconnecting… your seat and your spells are being kept.</div>` : ''}
    ${!others.length ? `<div class="ccode">${esc(C.code)}</div>
      <p class="help" style="text-align:center;margin:0 0 6px">${C.host ? 'Read the code out, or send it. Anyone who has it comes straight in.' : 'Everyone else has left.'}</p>` : ''}
    ${C.taken.length ? `<div class="cfeed"><span class="eyebrow">Taken from you</span>
      ${C.taken.slice(0, 5).map(x => `<div class="cfeed-row"><span class="dot c${x.color}"></span>
        <span class="tx"><b>${esc(x.who)}</b> took “${esc(short(x.text))}”${x.from === 'book' ? ' <span class="from">from your book</span>' : ''}</span>
        <span class="at">${new Date(x.at).toTimeString().slice(0, 5)}</span></div>`).join('')}
      ${C.taken.length > 5 ? `<div class="cfeed-more">and ${C.taken.length - 5} more</div>` : ''}</div>` : ''}
    <div class="filterbar cpeople">
      <button class="chip${C.view === 'all' ? ' on' : ''}" data-c="view" data-id="all">All</button>
      ${st.members.map(m => `<button class="chip${C.view === m.id ? ' on' : ''}${m.present ? '' : ' away'}" data-c="view" data-id="${esc(m.id)}">
        <span class="dot c${m.color}"></span>${m.id === C.me ? 'You' : esc(m.name)}${m.present ? '' : ' · away'}</button>`).join('')}
    </div>
    <div class="clist">${laid.length ? laid.map(circleCard).join('') : `<div class="empty"><b>${
      C.view === 'all' ? 'Nothing laid down yet' : C.view === C.me ? "You haven't laid anything down" : 'Nothing from them yet'}</b>${
      C.view === 'all' || C.view === C.me ? 'Lay a spell down and everyone here can read it, and take a copy.' : ''}</div>`}</div>
    <button class="btn" id="cLay">Lay down from your book</button>

    <div class="group"><span class="eyebrow">Books</span>
      <div class="item" style="cursor:default">
        ${BOOK_ICON}
        <span class="lab">Your book<span class="s">${C.bookOpen
          ? `Open — everyone here can look through all ${active().length} spells, and use your draw and book filters`
          : 'Closed — only what you lay down is seen'}</span></span>
        <div class="seg">
          <button data-c="book" data-on="1" class="${C.bookOpen ? 'on' : ''}">Open</button>
          <button data-c="book" data-on="0" class="${C.bookOpen ? '' : 'on'}">Closed</button>
        </div>
      </div>
      ${openBooks.map(m => `<button class="item" data-c="browse" data-id="${esc(m.id)}">
        <span class="dot c${m.color}" style="margin:0 5px"></span>
        <span class="lab">${esc(m.name)}’s book<span class="s">${C.books.get(m.id).spells.length} spells, open to the circle</span></span>
        <span class="val">Look</span></button>`).join('')}
      ${others.length && !openBooks.length ? `<p class="help" style="margin-top:8px">Nobody else has opened their book.</p>` : ''}
    </div>

    <button class="btn ${C.host ? 'danger' : 'ghost'}" id="cLeave" style="margin-top:22px">${C.host ? 'Close the circle' : 'Leave the circle'}</button>`;

  $('#cLay').onclick = openLaySheet;
  $('#cLeave').onclick = () => {
    circleSend({ t: C.host ? 'close' : 'leave' });
    circleEnd(C.host ? 'The circle is closed' : 'Left the circle');
  };
}

function circleCard(s){
  const mine = s.owner === C.me;
  const hearted = s.hearts.includes(C.me);
  const where = mine ? null : inBook(s.text);
  const took = s.takenBy.includes(C.me);
  return `<article class="ccard c${memberColor(s.owner)}${mine ? ' mine' : ''}" data-cid="${esc(s.id)}">
    <div class="cwho"><span class="dot c${memberColor(s.owner)}"></span>${mine ? 'You' : esc(memberName(s.owner))}</div>
    <p class="spell ${sizeClass(s.text)}">${fmt(s.text)}</p>
    ${s.tags.length ? `<div class="tags">${s.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="actions">
      ${mine
        ? `<span class="act still${s.hearts.length ? ' on' : ''}">${HEART}${s.hearts.length ? `<span class="n">${s.hearts.length}</span>` : ''}</span>
           <span class="cnote${s.takenBy.length ? ' taken' : ''}">${s.takenBy.length ? 'Taken by ' + esc(s.takenBy.map(memberName).join(', ')) : ''}</span>
           <button class="act right" data-c="pickup">Pick up</button>`
        : `<button class="act${hearted ? ' on' : ''}" data-c="heart" aria-label="This landed">${HEART}${s.hearts.length ? `<span class="n">${s.hearts.length}</span>` : ''}</button>
           ${where ? `<span class="cnote right">${took ? 'Taken' : pileWords(where)}</span>`
                   : `<button class="act right take" data-c="take">Take</button>`}`}
    </div></article>`;
}

/* One listener for everything the circle screen can tap, matched on
   data-c — kept apart from the cards' data-act, which answer to doc.spells. */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-c]');
  if(!b || !b.closest('#circle')) return;
  const c = b.dataset.c;
  if(c === 'view'){ C.view = b.dataset.id; renderCircle(); return; }
  if(c === 'book'){ setBookOpen(b.dataset.on === '1'); return; }
  if(c === 'browse'){ openBookSheet(b.dataset.id); return; }
  const card = b.closest('.ccard');
  const s = card && C.st && C.st.laid.find(x => x.id === card.dataset.cid);
  if(!s) return;
  if(c === 'heart'){ circleSend({ t:'heart', id:s.id }); buzz(8); }
  if(c === 'take'){ if(takeFromCircle(s)){ toast('Taken — it’s in your inbox'); renderCircle(); } }
  if(c === 'pickup'){
    const id = C.laid.get(s.key);
    if(id) pickUp(id); else circleSend({ t:'pickup', key:s.key });
  }
});

/* ---------- someone else's open book ----------
   A sheet over the circle: their spells, searchable, and filtered with the
   very same filter sheet as your own book — openFilterSheet() in index.html —
   over their tags and their situations. Their draw and book filters are one
   tap away, loaded as a starting point you can then change. The filter lives
   in memory for this circle only, and is remembered between looks at the same
   book. Tags are theirs, so 'question' and 'untagged' are worked out here
   against their situations. */

function foreignTags(s, book){
  const out = [...s.tags];
  if(s.text.includes('?')) out.push('question');
  if(!s.tags.some(t => book.situations.includes(t))) out.push('untagged');
  return out;
}
function foreignMatch(tags, f, extraRequire){
  const req = extraRequire && !f.require.includes(extraRequire) ? [...f.require, extraRequire] : f.require;
  if(f.include.length && !f.include.some(x => tags.includes(x))) return false;
  if(req.length && !req.every(x => tags.includes(x))) return false;
  if(f.exclude.length && f.exclude.some(x => tags.includes(x))) return false;
  return true;
}
function foreignPool(book, f, extraRequire){
  return book.spells.filter(s => foreignMatch(foreignTags(s, book), f, extraRequire));
}
/* Their vocabulary with live counts, the way allTags() gives yours: every tag
   they know, at 0 if nothing wears it, plus the two computed ones. */
function foreignTagCounts(book){
  const c = new Map();
  for(const t of [...book.tags, 'question', 'untagged']) c.set(t, 0);
  for(const s of book.spells) for(const t of foreignTags(s, book)) c.set(t, (c.get(t) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
const sameFilter = (a, b) => ['include', 'require', 'exclude'].every(k =>
  [...a[k]].sort().join('\n') === [...b[k]].sort().join('\n'));
const copyFilter = f => ({ include:[...f.include], require:[...f.require], exclude:[...f.exclude] });

function openBookSheet(owner){
  if(!C.books.has(owner)) return;
  if(!C.browse || C.browse.owner !== owner) C.browse = { owner, filter:newFilter(), q:'' };
  sheet('circle-book', `${memberName(owner)}’s book`, `
    <input id="cbSearch" placeholder="Search their book" autocomplete="off" spellcheck="false">
    <div class="filterbar" id="cbChips"></div>
    <div class="count" id="cbCount" style="padding:2px 0 0"></div>
    <div id="cbList"></div>`);
  $('#cbSearch').value = C.browse.q;
  $('#cbSearch').oninput = () => { C.browse.q = $('#cbSearch').value; renderBookSheet(); };
  renderBookSheet();
}

function openBookFilters(){
  const b = C.browse, book = b && C.books.get(b.owner);
  if(!book) return;
  const name = memberName(b.owner);
  openFilterSheet({
    f: b.filter, title: `${name}’s tags`,
    help: `These are ${name}’s tags and situations. It narrows only what you see of their book, and lasts as long as the circle.`,
    tags: foreignTagCounts(book),
    isSituation: t => t === 'untagged' || book.situations.includes(t),
    poolCount: () => foreignPool(book, b.filter).length,
    countWith: t => foreignPool(book, b.filter, t).length,
    changed: () => {},
    // Sheets never stack: the book comes back when the filter closes.
    then: () => setTimeout(() => { if(C.browse === b && C.books.has(b.owner)) openBookSheet(b.owner); })
  });
}

function renderBookSheet(){
  const b = C.browse, book = b && C.books.get(b.owner);
  if(!book || openSheetName() !== 'circle-book') return;
  const q = (b.q || '').trim().toLowerCase();
  const on = filterActive(b.filter);
  const presets = ['draw', 'book'].filter(k => book.filters[k] && filterActive(book.filters[k]));
  let list = foreignPool(book, b.filter);
  if(q) list = list.filter(s => s.text.toLowerCase().includes(q) || foreignTags(s, book).some(t => t.includes(q)));

  $('#cbChips').innerHTML = `
    <button class="chip${on ? ' on' : ''}" id="cbFilter">
      <svg viewBox="0 0 24 24"><path d="M3 5h18M6 12h12M10 19h4"/></svg>${esc(on ? tagFilterBits(b.filter).join(' · ') : 'Filter')}</button>
    ${presets.map(k => `<button class="chip${sameFilter(b.filter, book.filters[k]) ? ' on' : ''}" data-preset="${k}">Their ${k} filter</button>`).join('')}`;
  $('#cbCount').textContent = `${list.length} of ${book.spells.length} spells`;
  $('#cbList').innerHTML = list.length ? list.map(s => {
    const where = inBook(s.text);
    return `<div class="row brow">
      <div class="t">${esc(s.text.replace(/[*=]/g, ''))}</div>
      <div class="m"><span>${esc(foreignTags(s, book).slice(0, 4).join(' · '))}</span>
        ${where ? `<span class="mt" style="margin-left:auto">${pileWords(where)}</span>`
                : `<button class="act take" data-take="${esc(s.id)}" style="margin-left:auto">Take</button>`}</div></div>`;
  }).join('') : `<div class="empty"><b>${q ? 'Nothing found' : 'Nothing matches the filter'}</b>${q ? 'Try a different word.' : 'Adjust the filter to see more.'}</div>`;

  $('#cbFilter').onclick = openBookFilters;
  $('#cbChips').querySelectorAll('[data-preset]').forEach(x => x.onclick = () => {
    const p = book.filters[x.dataset.preset];
    b.filter = sameFilter(b.filter, p) ? newFilter() : copyFilter(p);
    renderBookSheet();
  });
  $('#cbList').querySelectorAll('[data-take]').forEach(x => x.onclick = () => {
    const s = book.spells.find(y => y.id === x.dataset.take);
    if(s && takeFromBook(b.owner, s)){ toast('Taken — it’s in your inbox'); renderBookSheet(); }
  });
}

/* ---------- the relay's address ---------- */

function openRelaySheet(){
  sheet('circle-relay', 'Relay', `
    <div class="field"><label for="rUrl">Address</label>
      <input id="rUrl" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url"
        placeholder="spellbook-relay.you.workers.dev" value="${esc(relayLabel(cleanRelay(S.relayUrl) || RELAY_URL))}"></div>
    <p class="help">The address <code>wrangler deploy</code> printed — with or without https://.
      Empty goes back to the built-in one, ${esc(relayLabel(RELAY_URL))}.</p>
    <p class="help" id="rStatus"></p>
    <button class="btn" id="rSave">Save</button>
    <button class="btn ghost" id="rTest">Test the connection</button>`);
  const read = () => {
    const v = $('#rUrl').value.trim();
    return v ? cleanRelay(v) : RELAY_URL;
  };
  $('#rSave').onclick = () => {
    const v = $('#rUrl').value.trim(), c = read();
    if(v && !c){ $('#rStatus').textContent = "That isn't an address."; return; }
    S.relayUrl = (!v || c === RELAY_URL) ? '' : c;
    persist(); closeSheet(); renderCircle();
    toast('Relay saved');
  };
  $('#rTest').onclick = async () => {
    const c = read();
    if(!c){ $('#rStatus').textContent = "That isn't an address."; return; }
    $('#rStatus').textContent = `Trying ${relayLabel(c)}…`;
    const ok = await testRelay(c);
    if(openSheetName() !== 'circle-relay') return;
    $('#rStatus').textContent = ok ? `Reached ${relayLabel(c)}.`
      : `Couldn't reach ${relayLabel(c)}. Check the address, and that the phone is online — a brand-new workers.dev address can take a few minutes to start answering.`;
  };
}

/* ---------- laying down, from the book ----------
   The picker has its own sticky filter, `S.filters.lay`, like every other
   screen that picks spells (decisions/0010): what you narrow to choose what
   to show people shouldn't narrow your next draw. */

function openLaySheet(){
  sheet('circle-lay', 'Lay down', `
    <input id="clSearch" placeholder="Search the book" autocomplete="off" spellcheck="false">
    <div class="filterbar" id="clFilterBar"></div>
    <p class="help" style="margin-top:2px">Tap a spell to lay it in the circle, and again to pick it up.</p>
    <div id="clList"></div>`);
  $('#clSearch').oninput = renderLayList;
  renderLayList();
}

function renderLayList(){
  const box = $('#clList');
  if(!box) return;
  const on = filterActive(S.filters.lay);
  $('#clFilterBar').innerHTML = `<button class="chip${on ? ' on' : ''}" id="clFilter">
    <svg viewBox="0 0 24 24"><path d="M3 5h18M6 12h12M10 19h4"/></svg>${esc(on ? tagFilterBits(S.filters.lay).join(' · ') : 'Filter')}</button>`;
  // The filter sheet takes the place of this one, and this one comes back
  // when it closes — two sheets never stack.
  $('#clFilter').onclick = () => {
    const q = $('#clSearch').value;
    openFilters('lay', () => setTimeout(() => {
      if(!circleLive()) return;
      openLaySheet(); $('#clSearch').value = q; renderLayList();
    }));
  };
  const q = ($('#clSearch').value || '').trim().toLowerCase();
  let list = pool('lay');
  if(q) list = list.filter(s => s.text.toLowerCase().includes(q) || tagsOf(s).some(t => t.includes(q)));
  list = list.slice().sort((a, b) => (laidKey(b.id) ? 1 : 0) - (laidKey(a.id) ? 1 : 0)
    || (b.source?.capturedAt || '').localeCompare(a.source?.capturedAt || ''));
  box.innerHTML = list.length ? list.map(s => `<button class="row${laidKey(s.id) ? ' laid' : ''}" data-lay="${s.id}">
      <div class="t">${esc(s.text.replace(/[*=]/g, ''))}</div>
      <div class="m">${laidKey(s.id) ? '<span class="mt">in the circle</span>' : ''}
        <span>${esc(s.tags.filter(t => !keptHome().includes(t)).slice(0, 4).join(' · '))}</span></div></button>`).join('')
    : `<div class="empty"><b>Nothing found</b>${on ? 'Loosen the filter, or try another word.' : 'Try a different word.'}</div>`;
  box.querySelectorAll('[data-lay]').forEach(b => b.onclick = () => {
    const s = doc.spells.find(x => x.id === b.dataset.lay);
    if(laidKey(s.id)) pickUp(s.id); else layDown(s);
    buzz(8);
    renderLayList();
  });
}

/* The detail sheet's door into the circle, while there is one. */
function circleSheetButton(s){
  if(!circleLive() || s.state !== ACTIVE) return '';
  return `<button class="btn ghost" id="spCircle">${laidKey(s.id) ? 'Pick up from the circle' : 'Lay down in the circle'}</button>`;
}
function wireCircleSheetButton(s){
  const b = $('#spCircle');
  if(!b) return;
  b.onclick = () => {
    const was = !!laidKey(s.id);
    if(was) pickUp(s.id); else layDown(s);
    b.textContent = was ? 'Lay down in the circle' : 'Pick up from the circle';
    toast(was ? 'Picked up' : 'Laid down in the circle');
  };
}
