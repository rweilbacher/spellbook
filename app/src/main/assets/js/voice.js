/* Spellbook · voice.js
   Voice notes, and the single inbound channel from Kotlin.
   Loaded by index.html before the inline script. Plain script, shared
   globals — no imports, no build step. Order does not matter among these. */

/* =========================================================================
   Voice notes — spoken instead of typed, landing in the same thread.
   The recording itself happens in Kotlin: the web layer can ask the browser
   engine for a microphone, but it gets whatever input the system considers
   default and has no say in it, and routing to a headset is most of why
   this exists. So this half is only the UI — ask, show something alive
   while it runs, and take { file, duration } back at the end.
   ========================================================================= */
const MEDIA = 'https://appassets.androidplatform.net/media/';
const canRecord = () => !!(Bridge && Bridge.startVoiceNote);

/* Null means "we can't know" — desktop preview, where nothing is missing
   because nothing was ever there. Only a real answer marks a note lost. */
let onDisk = null;
let rec = null;              // the recording in flight, if any
let player = null, playing = null;

const clock = secs => Math.floor(secs/60) + ':' + String(Math.round(secs)%60).padStart(2,'0');

function refreshMedia(){
  if(!Bridge || !Bridge.mediaList) return;
  try{ onDisk = new Set(JSON.parse(Bridge.mediaList() || '[]')); }
  catch(e){ onDisk = null; }
}
function audioMissing(n){
  return !!(n && n.type === 'voice' && onDisk && n.file && !onDisk.has(n.file));
}
function dropMedia(file){
  if(Bridge && Bridge.deleteMedia){ try{ Bridge.deleteMedia(file); }catch(e){} }
  if(onDisk) onDisk.delete(file);
}

/* Housekeeping at boot: audio on disk that no note refers to any more —
   a note deleted while the bridge was unavailable, or an import that
   dropped one. Cheap, and it runs once. */
function sweepMedia(){
  if(!Bridge || !Bridge.pruneMedia) return;
  const keep = [];
  for(const s of doc.spells)
    for(const n of (s.notes || []))
      if(n.type === 'voice' && n.file) keep.push(n.file);
  try{ Bridge.pruneMedia(JSON.stringify(keep)); }catch(e){}
}

function micBtn(id){
  if(!canRecord()) return '';
  return `<button class="btn ghost mic" id="${id}">
    <svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3z"/><path d="M5 11a7 7 0 0014 0M12 18.5V21"/></svg>
    Say it instead</button>`;
}

/* back() is how we get out: to the thread if we came from it, or simply
   shut, if we came from the card's quick action. */
function startVoiceNote(s, back){
  if(!canRecord()){ toast('Recording needs the app'); return; }
  rec = { spell:s, back, ms:0, level:0, state:'arming', bluetooth:false, via:'' };
  paintRecorder();
  try{ Bridge.startVoiceNote(!!S.btMic); }
  catch(e){ rec = null; toast('Could not start recording'); back(); }
}

function paintRecorder(){
  if(!rec) return;
  const label = rec.state === 'recording' ? clock(rec.ms/1000)
    : rec.state === 'saving' ? 'Saving…'
    : 'Getting ready…';
  sheet('voice-note', 'Voice note', `
    <div class="vrec">
      <div class="vdot${rec.state === 'recording' ? ' live' : ''}"></div>
      <div class="vtime" id="vTime">${esc(label)}</div>
      <div class="vmeter"><i id="vLevel"></i></div>
      ${rec.via && rec.via !== '…' ? `<p class="via">Through ${esc(rec.via)}</p>` : ''}
    </div>
    <button class="btn" id="vStop"${rec.state === 'recording' ? '' : ' disabled style="opacity:.45"'}>Stop and save</button>
    <button class="btn ghost" id="vDiscard">Discard</button>
  `, {keep:true});
  const stop = $('#vStop'), drop = $('#vDiscard');
  if(stop) stop.onclick = () => {
    if(!rec){ closeSheet(); return; }
    if(rec.state !== 'recording') return;
    rec.state = 'saving'; paintRecorder();
    try{ Bridge.stopVoiceNote(); }catch(e){}
  };
  if(drop) drop.onclick = () => {
    if(!rec){ closeSheet(); return; }
    try{ Bridge.cancelVoiceNote(); }catch(e){}
  };
}

/* Levels arrive eight times a second. Touch the two nodes that change
   rather than re-rendering the sheet under the user's finger. */
function paintLevel(){
  const t = $('#vTime'), l = $('#vLevel');
  if(t && rec && rec.state === 'recording') t.textContent = clock(rec.ms/1000);
  if(l && rec) l.style.transform = `scaleX(${rec.level.toFixed(3)})`;
}

/* The single channel back from Kotlin. */
window.onNative = function(raw){
  let e;
  try{ e = JSON.parse(raw); }catch(err){ return; }

  if(e.kind === 'backup'){
    if(e.message) toast(e.message);
    if(!$('#vault').classList.contains('hide')) renderVault();
    return;
  }
  /* A reminder or widget tapped while the app was already open — onCreate
     never ran, so this arrives as an event rather than through
     openRequest(). */
  if(e.kind === 'open'){
    handleOpenRequest(e.target);
    return;
  }
  /* Either an answer to the prompt, or the quiet re-check on resume that
     catches the permission being turned on in Android's own settings. */
  if(e.kind === 'notify'){
    if(!e.granted && !e.quiet && (S.notifyTimes||[]).length){
      toast('Reminders are set, but Android is holding them back');
    }
    if(!$('#vault').classList.contains('hide')) renderVault();
    if(openSheetName() === 'reminders') openReminders(true);
    return;
  }
  if(e.kind !== 'voice' || !rec) return;

  const done = () => { const r = rec; rec = null; return r; };

  if(e.type === 'routing'){ rec.state = 'arming'; paintRecorder(); }
  else if(e.type === 'fellBack'){ rec.bluetooth = false; }
  else if(e.type === 'started'){
    rec.state = 'recording'; rec.bluetooth = !!e.bluetooth; buzz(12); paintRecorder();
  }
  else if(e.type === 'level'){ rec.ms = e.ms || 0; rec.level = e.level || 0; paintLevel(); }
  /* What the audio stack actually handed us, which is not always what we
     asked it for — and can change under a note halfway through. */
  else if(e.type === 'route'){
    if(e.via !== rec.via){ rec.via = e.via; paintRecorder(); }
  }
  else if(e.type === 'saved'){
    const r = done();
    addNoteToSpell(r.spell, {type:'voice', file:e.file, duration:e.duration});
    refreshMedia(); buzz(18); r.back(); toast('Voice note added');
  }
  else if(e.type === 'tooShort'){ const r = done(); r.back(); toast('Too short — hold on a moment longer'); }
  else if(e.type === 'cancelled'){ const r = done(); r.back(); }
  else if(e.type === 'denied'){ const r = done(); r.back(); toast('Spellbook needs permission to use the microphone'); }
  else if(e.type === 'error'){ const r = done(); r.back(); toast(e.message || 'That recording failed'); }
};

/* One player at a time, made fresh each tap — there's no seeking to
   preserve (the asset loader doesn't answer range requests) and a note is
   short enough that starting over is no loss. */
function togglePlay(btn){
  const file = btn.dataset.file;
  if(!file) return;
  if(playing === btn && player && !player.paused){ stopPlayback(); return; }
  stopPlayback();
  player = new Audio(MEDIA + encodeURIComponent(file));
  playing = btn;
  setPlaying(btn, true);
  const bar = btn.parentElement && btn.parentElement.querySelector('.vwave i');
  player.ontimeupdate = () => {
    if(bar && player.duration) bar.style.transform = `scaleX(${(player.currentTime/player.duration).toFixed(3)})`;
  };
  player.onended = () => { if(bar) bar.style.transform = 'scaleX(0)'; stopPlayback(); };
  player.onerror = () => { stopPlayback(); toast('Could not play that recording'); };
  player.play().catch(() => { stopPlayback(); toast('Could not play that recording'); });
}
function stopPlayback(){
  if(player){ try{ player.pause(); }catch(e){} }
  if(playing) setPlaying(playing, false);
  player = null; playing = null;
}
function setPlaying(btn, on){
  btn.classList.toggle('on', on);
  btn.querySelector('svg').innerHTML = on
    ? '<path d="M8 5h3v14H8zM13 5h3v14h-3z"/>'
    : '<path d="M8 5l11 7-11 7z"/>';
}
