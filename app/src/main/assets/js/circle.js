/* Spellbook · circle.js
   The circle: two or more books in a room together. Lay spells down, take
   copies of each other's into your own book. The spec is "The circle" in
   docs/roadmap.md; the relay, and the protocol, are in relay/room.js.
   Loaded by index.html before the inline script. Plain script, shared
   globals — no imports, no build step. Order does not matter among these.

   The socket lives here, in the page, not in Kotlin. There is no key to
   keep out of the web layer and no CORS for a WebSocket, and keeping it here
   means the circle works in preview mode too — a phone and a desktop browser
   can sit in the same circle, which is how it gets tested by hand.

   What leaves the phone: a spell's text and its filing tags, when you lay it
   down; the name you give. Nothing else — not notes, recordings, counts, the
   pile it's in, or its source. inbox and flagged stay home too: they are
   marks about how a spell is doing for you, not how it's filed.

   Nothing is opened at boot. No circle, no socket. */

/* Where the relay lives, unless the circle screen's Relay setting
   (S.relayUrl) says otherwise — that's the one to change after a deploy,
   no new APK needed. In preview mode ?relay=ws://localhost:8787 points the
   page at tools/relay.mjs and beats both. */
const RELAY_URL = 'wss://spellbook-relay.rweilbacher.workers.dev';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';     // no 0/O, no 1/I
const CIRCLE_CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;
const RETRY_S = [1, 2, 4, 8, 15, 30];
const GIVE_UP_MS = 6 * 60 * 1000;   // a little past the relay's five-minute seat
/* A function, not a constant: INBOX and the rest are declared by the inline
   script, which runs after this file. */
const keptHome = () => [INBOX, FLAGGED];

/* The whole client state. `phase` is one of
     idle · connecting · waiting · live · away
   `away` is live with the socket down: the seat is held for us, and we keep
   trying to get back to it. */
const C = {
  phase:'idle', code:'', host:false, token:null, me:null,
  st:null,                 // the last state the relay sent
  laid:new Map(),          // key → spell id: what this phone has laid down
  ws:null, retry:0, retryTimer:null, ping:null, awaySince:0, tries:0, heard:0,
  view:'all',              // whose spells the screen is showing
  seenKnocks:new Set(), seenTakes:new Set()
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
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return [...b].map(x => CODE_CHARS[x % CODE_CHARS.length]).join('');
}
function circleLive(){ return C.phase === 'live' || C.phase === 'away'; }

/* ---------- the connection ---------- */

function circleStart(host, code){
  const name = (S.circleName || '').trim();
  if(!name){ toast('Give yourself a name first'); return; }
  Object.assign(C, { host, code: host ? newCode() : code, token:null, me:null, st:null,
    view:'all', tries:0, retry:0 });
  C.laid.clear(); C.seenKnocks.clear(); C.seenTakes.clear();
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
   let in there is nothing to get back to; after, the relay holds the seat
   and we keep knocking on the same token. */
function circleDropped(){
  clearInterval(C.ping); C.ping = null;
  C.ws = null;
  if(C.phase === 'idle') return;
  if(!C.token){ circleEnd(C.phase === 'waiting' ? 'Lost the connection' : `Couldn't reach the relay at ${relayLabel()}`); return; }
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
  clearInterval(C.ping); clearTimeout(C.retryTimer);
  C.ping = null; C.retryTimer = null;
  Object.assign(C, { phase:'idle', token:null, me:null, st:null, view:'all' });
  C.laid.clear();
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
    // The phones are the record. Whatever this one had laid down goes back
    // into the circle, which is a no-op if the relay still has it and a
    // rebuild if it doesn't.
    for(const [key, id] of C.laid){
      const s = doc.spells.find(x => x.id === id);
      if(s && s.state === ACTIVE) circleSend(layMessage(key, s));
      else { C.laid.delete(key); circleSend({ t:'pickup', key }); }   // buried or shelved meanwhile
    }
    if(first && !C.host) toast("You're in");
    circleRefresh();
  }
  else if(m.t === 'waiting'){ C.phase = 'waiting'; circleRefresh(); }
  else if(m.t === 'refused'){ circleEnd("The host didn't let you in"); }
  else if(m.t === 'closed'){ circleEnd(C.host ? 'The circle is closed' : 'The host closed the circle'); }
  else if(m.t === 'state'){ circleNotice(m); C.st = m; circleRefresh(); }
  else if(m.t === 'error'){
    if(m.code === 'taken' && C.host && !C.token && C.tries++ < 6){
      C.code = newCode(); circleConnect();       // someone has that code; pick another
    }
    else if(m.code === 'nohost') circleEnd(C.token ? 'The circle has closed' : 'No circle with that code');
    else if(m.code === 'full') circleEnd('That circle is full');
    else if(m.code === 'limit') toast("That's as many as you can lay down at once");
    else if(m.code === 'taken') circleEnd("Couldn't open a circle");
  }
}

/* The two things worth interrupting you for when you're elsewhere in the
   book: someone at the door, and someone taking a spell of yours. Each is
   said once. */
function circleNotice(st){
  const here = !$('#circle').classList.contains('hide');
  for(const k of st.knocks){
    if(C.seenKnocks.has(k.id)) continue;
    C.seenKnocks.add(k.id);
    if(!here) toast(`${k.name} is at the door`);
    buzz(15);
  }
  for(const s of st.laid){
    if(s.owner !== C.me) continue;
    for(const who of s.takenBy){
      const tag = s.id + '>' + who;
      if(C.seenTakes.has(tag)) continue;
      C.seenTakes.add(tag);
      // A re-sent state after a reconnect isn't news.
      if(C.st && !C.st.laid.some(x => x.id === s.id && x.takenBy.includes(who)))
        toast(`${memberName(who)} took “${short(s.text)}”`);
    }
  }
}

/* ---------- the spells ---------- */

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

/* Taking a spell. Not mergeSpells, which is for your own book arriving from
   another phone — it matches ids, overwrites, and carries notes across.
   This is a stranger's line entering your book: a fresh id, the words and
   nothing else, the inbox because it's unproven here, and where it came
   from in the source. No tags: their vocabulary is theirs, and you file it
   yourself in triage like anything else. */
function takeFromCircle(item){
  const text = (item.text || '').trim();
  if(!text || inBook(text)) return null;
  const today = now().slice(0, 10);
  const s = { id:uid(), text, tags:[INBOX], useful:0, drawn:0, lastDrawn:null,
    state:ACTIVE, desked:null, notes:[], createdAt:now(), updatedAt:now(),
    source:{ origin:'circle', note:'from ' + memberName(item.owner), file:null, line:null, url:null,
             capturedAt:today } };
  doc.spells.push(s);
  syncTagVocabulary();
  persist();
  circleSend({ t:'take', id:item.id });
  buzz(10);
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

/* Called on every change of phase or state: the nav tab exists only while
   there is a circle, and whatever's on screen redraws. */
function circleRefresh(){
  $('#navCircle').classList.toggle('hide', C.phase === 'idle');
  if(!$('#circle').classList.contains('hide')) renderCircle();
  if(!$('#vault').classList.contains('hide')) renderVault();
  if(openSheetName() === 'circle-lay') renderLayList();
}

function circleSummary(){
  if(C.phase === 'idle') return 'Open one, or join with a code';
  if(C.phase === 'waiting') return `Waiting at the door of ${C.code}`;
  if(C.phase === 'connecting') return 'Connecting…';
  const n = C.st ? C.st.members.length : 1;
  return `${C.code} · ${n} here${C.phase === 'away' ? ' · reconnecting' : ''}`;
}

function renderCircle(){
  const body = $('#circleBody');
  const meta = $('#circleMeta');
  meta.textContent = circleLive() ? circleSummary() : '';

  if(C.phase === 'idle'){
    body.innerHTML = `
      <p class="help" style="margin-top:0">Lay spells down for each other and take copies into your own book.
        Nothing in your book is seen until you lay it down.</p>
      <div class="field"><label for="cName">Your name</label>
        <input id="cName" maxlength="24" autocomplete="off" placeholder="What the circle calls you" value="${esc(S.circleName || '')}"></div>
      <button class="btn" id="cOpen">Open a circle</button>
      <div class="decay-divider"><span>or join one</span></div>
      <div class="field"><label for="cCode">Code</label>
        <input id="cCode" class="ccode-in" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="K7QX"></div>
      <button class="btn ghost" id="cJoin">Join</button>
      <div class="banner">Spells travel through a relay that keeps nothing and forgets the circle when it ends.
        Only a spell's words and filing tags are sent — never its notes, recordings, counts or source.</div>
      <div class="group"><span class="eyebrow">Relay</span>
        <button class="item" id="cRelay">
          <svg viewBox="0 0 24 24"><path d="M4 12h16"/><circle cx="4" cy="12" r="2"/><circle cx="20" cy="12" r="2"/><path d="M12 7v10"/></svg>
          <span class="lab">${esc(relayLabel())}<span class="s">${S.relayUrl ? 'Set here' : 'The built-in address'}</span></span>
          <span class="val">Change</span></button></div>`;
    $('#cRelay').onclick = openRelaySheet;
    const keepName = () => { const v = $('#cName').value.trim().slice(0, 24); if(v !== (S.circleName || '')){ S.circleName = v; persist(); } };
    $('#cName').onchange = keepName;
    $('#cOpen').onclick = () => { keepName(); circleStart(true); };
    $('#cJoin').onclick = () => {
      keepName();
      const code = $('#cCode').value.trim().toUpperCase();
      if(!CIRCLE_CODE_RE.test(code)){ toast('A code is four letters and numbers'); return; }
      circleStart(false, code);
    };
    $('#cCode').oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    return;
  }

  if(C.phase === 'connecting' || C.phase === 'waiting'){
    const waiting = C.phase === 'waiting';
    body.innerHTML = `
      <div class="ccode">${esc(C.code)}</div>
      <div class="empty" style="padding-top:8px"><b>${C.host ? 'Opening the circle…' : waiting ? 'Waiting to be let in' : 'Knocking…'}</b>
        ${waiting ? 'The host has to open the door.' : ''}</div>
      <button class="btn ghost" id="cCancel">Cancel</button>`;
    $('#cCancel').onclick = () => { circleSend({ t:'leave' }); circleEnd(); };
    return;
  }

  const st = C.st || { members:[], knocks:[], laid:[] };
  const others = st.members.filter(m => m.id !== C.me);
  if(C.view !== 'all' && !st.members.some(m => m.id === C.view)) C.view = 'all';
  const laid = st.laid.filter(s => C.view === 'all' || s.owner === C.view);

  body.innerHTML = `
    ${C.phase === 'away' ? `<div class="banner" style="margin-top:0">Reconnecting… your seat and your spells are being kept.</div>` : ''}
    ${st.knocks.map(k => `<div class="knock">
        <span><b>${esc(k.name)}</b> is at the door</span>
        <button class="chip on" data-c="approve" data-id="${esc(k.id)}">Let in</button>
        <button class="chip" data-c="refuse" data-id="${esc(k.id)}">Turn away</button></div>`).join('')}
    ${!others.length ? `<div class="ccode">${esc(C.code)}</div>
      <p class="help" style="text-align:center;margin:0 0 6px">${C.host ? 'Read the code out, or send it. Nobody is in yet.' : 'Everyone else has left.'}</p>` : ''}
    <div class="filterbar cpeople">
      <button class="chip${C.view === 'all' ? ' on' : ''}" data-c="view" data-id="all">All</button>
      ${st.members.map(m => `<button class="chip${C.view === m.id ? ' on' : ''}${m.present ? '' : ' away'}" data-c="view" data-id="${esc(m.id)}">
        <span class="dot c${m.color}"></span>${m.id === C.me ? 'You' : esc(m.name)}${m.present ? '' : ' · away'}</button>`).join('')}
    </div>
    <div class="clist">${laid.length ? laid.map(circleCard).join('') : `<div class="empty"><b>${
      C.view === 'all' ? 'The circle is empty' : C.view === C.me ? "You haven't laid anything down" : 'Nothing from them yet'}</b>${
      C.view === 'all' || C.view === C.me ? 'Lay a spell down and everyone here can read it, and take a copy.' : ''}</div>`}</div>
    <button class="btn" id="cLay">Lay down from your book</button>
    <button class="btn ${C.host ? 'danger' : 'ghost'}" id="cLeave">${C.host ? 'Close the circle' : 'Leave the circle'}</button>`;

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
  const heart = `<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.7-7.5-10a4.2 4.2 0 017.5-2.6A4.2 4.2 0 0119.5 10.5c0 5.3-7.5 10-7.5 10z"/></svg>`;
  return `<article class="ccard c${memberColor(s.owner)}${mine ? ' mine' : ''}" data-cid="${esc(s.id)}">
    <div class="cwho"><span class="dot c${memberColor(s.owner)}"></span>${mine ? 'You' : esc(memberName(s.owner))}</div>
    <p class="spell ${sizeClass(s.text)}">${fmt(s.text)}</p>
    ${s.tags.length ? `<div class="tags">${s.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="actions">
      ${mine
        ? `<span class="act still${s.hearts.length ? ' on' : ''}">${heart}${s.hearts.length ? `<span class="n">${s.hearts.length}</span>` : ''}</span>
           <span class="cnote">${s.takenBy.length ? 'Taken by ' + esc(s.takenBy.map(memberName).join(', ')) : ''}</span>
           <button class="act right" data-c="pickup">Pick up</button>`
        : `<button class="act${hearted ? ' on' : ''}" data-c="heart" aria-label="This landed">${heart}${s.hearts.length ? `<span class="n">${s.hearts.length}</span>` : ''}</button>
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
  if(c === 'approve' || c === 'refuse'){ circleSend({ t:c, id:b.dataset.id }); return; }
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

/* ---------- laying down, from the book ---------- */

function openLaySheet(){
  sheet('circle-lay', 'Lay down', `
    <input id="clSearch" placeholder="Search the book" autocomplete="off" spellcheck="false">
    <p class="help">Tap a spell to lay it in the circle, and again to pick it up.</p>
    <div id="clList"></div>`);
  $('#clSearch').oninput = renderLayList;
  renderLayList();
}

function renderLayList(){
  const box = $('#clList');
  if(!box) return;
  const q = ($('#clSearch').value || '').trim().toLowerCase();
  let list = active();
  if(q) list = list.filter(s => s.text.toLowerCase().includes(q) || tagsOf(s).some(t => t.includes(q)));
  list = list.slice().sort((a, b) => (laidKey(b.id) ? 1 : 0) - (laidKey(a.id) ? 1 : 0)
    || (b.source?.capturedAt || '').localeCompare(a.source?.capturedAt || ''));
  box.innerHTML = list.length ? list.map(s => `<button class="row${laidKey(s.id) ? ' laid' : ''}" data-lay="${s.id}">
      <div class="t">${esc(s.text.replace(/[*=]/g, ''))}</div>
      <div class="m">${laidKey(s.id) ? '<span class="mt">in the circle</span>' : ''}
        <span>${esc(s.tags.filter(t => !keptHome().includes(t)).slice(0, 4).join(' · '))}</span></div></button>`).join('')
    : `<div class="empty"><b>Nothing found</b>Try a different word.</div>`;
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
