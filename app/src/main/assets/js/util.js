/* Spellbook · util.js
   Small helpers used everywhere.
   Loaded by index.html before the inline script. Plain script, shared
   globals — no imports, no build step. Order does not matter among these. */

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
/* The three piles. active() is the book — the draw, the library, the desk and
   every tag count read it, so a spell leaving ACTIVE leaves all of them at
   once. That is the whole reason the shelf is a state and not a tag. */
const active = () => doc.spells.filter(s => s.state === ACTIVE);
const buried = () => doc.spells.filter(s => s.state === GRAVEYARD);
const shelved = () => doc.spells.filter(s => s.state === SHELVED);
/* Every attribute this app writes is double-quoted, so ' was already safe —
   but "safe because of a convention held somewhere else" is not a property
   you want in the one function everything untrusted passes through. */
const esc = s => s.replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => 'sp_' + Math.random().toString(16).slice(2,10);
const nid = () => 'nt_' + Math.random().toString(16).slice(2,10);
const now = () => new Date().toISOString();

function fmt(text){
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/==(.+?)==/g, '<i class="mk">$1</i>');
}
function sizeClass(t){
  const n = t.replace(/[*=]/g,'').length;
  return n < 46 ? 'lg' : n > 300 ? 'sm' : '';
}
function toast(msg){
  const old = $('#toast'); if(old) old.remove();
  const el = document.createElement('div');
  el.id = 'toast'; el.textContent = msg;
  if(document.querySelector('.sheet')) el.classList.add('high');
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 2100);
}
function buzz(ms){ if(navigator.vibrate) try{ navigator.vibrate(ms); }catch(e){} }

/* Every tag the book knows, with how many active spells wear it right now.
   The list comes from `doc.tags` — the stored vocabulary — rather than from
   counting membership, so a tag sits at 0 instead of vanishing the moment its
   last spell is retagged or buried. That distinction is load-bearing: filter
   state (S.include / require / exclude) outlives the count, so a tag that
   disappeared took its own off-switch with it and left the pool empty with
   nothing on screen to clear. Deleting a tag in the tag manager is now the
   only thing that removes an entry.

   STRUCTURAL is seeded in for the same reason. Those three are computed at
   render time and are never in the vocabulary — but 'untagged' reaching 0 is
   the good outcome, and it must not strand a filter set on it. */
function allTags(){
  const c = new Map();
  for(const t of (Array.isArray(doc.tags) ? doc.tags : [])) c.set(t, 0);
  for(const t of STRUCTURAL) c.set(t, 0);
  for(const s of doc.spells){ if(s.state !== ACTIVE) continue;
    for(const t of tagsOf(s)) c.set(t, (c.get(t)||0)+1); }
  return [...c.entries()].sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]));
}
