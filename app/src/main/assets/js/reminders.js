/* Spellbook · reminders.js
   Up to three reminders a day.
   Loaded by index.html before the inline script. Plain script, shared
   globals — no imports, no build step. Order does not matter among these. */

/* =========================================================================
   Reminders

   Up to three times a day, stored as settings in the book like everything
   else — so they export, back up and restore with it, and Kotlin can read
   them at boot without the WebView. The page owns the times and the
   wording; Kotlin owns the alarms and whether Android will let a
   notification through at all.

   Deliberately a knock and not a draw. Tapping one lands on the sigil with
   nothing cast, because a spell drawn by a notification you never opened
   would spend itself against a locked screen.
   ========================================================================= */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/* The cap and the default wording are Kotlin's — Reminders.MAX and
   Reminders.DEFAULT_TEXT — and notifyState() has been sending both across
   the bridge all along. The page used to keep its own copies and ignore
   what it was told, which is exactly how two constants drift apart. Read
   once: they're compile-time constants on the other side. The fallbacks are
   for preview mode, where there is no bridge to ask. */
const NOTIFY_MAX_FALLBACK = 3;
const NOTIFY_TEXT_FALLBACK = 'The book is open. Where are you?';
let notifyLimitsCache = null;
function notifyLimits(){
  if(!notifyLimitsCache){
    const st = notifyState();
    const max = Number(st.max);
    notifyLimitsCache = {
      max: max > 0 ? max : NOTIFY_MAX_FALLBACK,
      defaultText: (typeof st.defaultText === 'string' && st.defaultText) || NOTIFY_TEXT_FALLBACK
    };
  }
  return notifyLimitsCache;
}

/** Always stored sorted, deduped and capped, so an index into the list in
 *  the sheet is an index into the setting. */
function cleanTimes(list){
  if(!Array.isArray(list)) return [];
  return [...new Set(list.filter(t => typeof t === 'string' && TIME_RE.test(t)))]
    .sort().slice(0, notifyLimits().max);
}

function notifyState(){
  if(!Bridge || !Bridge.notifyState) return {supported:false, canPost:false};
  try{ return Object.assign({supported:true, canPost:false}, JSON.parse(Bridge.notifyState() || '{}')); }
  catch(e){ return {supported:false, canPost:false}; }
}

function openRequest(){
  if(!Bridge || !Bridge.openRequest) return '';
  try{ return Bridge.openRequest() || ''; }catch(e){ return ''; }
}

/** Back to the altar with the last cast cleared away — what a reminder opens
 *  onto, and what tapping one mid-session should also give you. */
function freshDraw(){
  if(!rec) closeSheet();
  const res = $('#results'), scr = $('#draw'), label = $('#castLabel');
  if(res) res.innerHTML = '';
  if(scr) scr.classList.remove('revealed');
  if(label && !cooling){ label.textContent = 'touch to cast'; label.classList.add('ready'); }
  go('draw');
}

function notifySummary(){
  const t = S.notifyTimes || [];
  if(!t.length) return 'Nothing set — the book waits to be opened';
  const st = notifyState();
  const when = t.join('  ·  ');
  return st.supported && !st.canPost ? when + ' · not getting through' : when;
}

/** The next sensible hour to offer, skipping any already taken. */
function nextFreeTime(){
  const taken = S.notifyTimes || [];
  return ['09:00','13:00','20:00','07:30','22:00'].find(t => !taken.includes(t)) || '12:00';
}

function saveTimes(list){
  S.notifyTimes = cleanTimes(list);
  persist();                 // the save is also what re-arms the alarms
  renderVault();
}

function openReminders(keep){
  const st = notifyState();
  const times = S.notifyTimes || [];
  const lim = notifyLimits();
  const custom = (S.notifyText || '') !== lim.defaultText;

  const rows = times.length ? times.map((t,i)=>`
    <div class="item" style="cursor:default;gap:10px">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.2 2"/></svg>
      <input type="time" step="60" data-at="${i}" value="${esc(t)}"
        style="flex:1;min-width:0;padding:9px 10px;text-align:center">
      <button class="act" data-drop="${i}" aria-label="Remove this time">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>`).join('')
    : `<p class="help" style="margin:0 0 16px">None set. The book only speaks when you open it.</p>`;

  sheet('reminders', 'Reminders', `
    <p class="help" style="margin-top:0">Up to ${lim.max} a day. Tapping one opens the
      book at the sigil — nothing is drawn until you cast.</p>

    ${!st.supported ? `<div class="banner">Preview mode has no alarms to set. Inside
      the Android shell these are real.</div>` : ''}
    ${st.supported && times.length && !st.canPost ? `<div class="banner">Android
      isn't letting notifications through yet.
      <button class="btn ghost" id="nPerm" style="margin-top:10px">Allow notifications</button>
      <button class="btn ghost" id="nSettings" style="margin-top:8px">Open system settings</button>
      </div>` : ''}

    <div id="nRows">${rows}</div>
    ${times.length < lim.max
      ? `<button class="btn ghost" id="nAdd">Add a time</button>`
      : `<p class="help" style="margin:4px 0 0">That's the most it will hold.</p>`}

    <p class="help" style="margin:24px 0 8px">What it says</p>
    <input type="text" id="nText" maxlength="120" style="width:100%"
      value="${esc(S.notifyText || lim.defaultText)}">
    ${custom ? `<button class="btn ghost" id="nReset" style="margin-top:10px">Put the default wording back</button>` : ''}
  `, {keep});

  $('#nRows').querySelectorAll('input[data-at]').forEach(inp => inp.onchange = () => {
    const list = (S.notifyTimes || []).slice();
    if(!TIME_RE.test(inp.value)){ openReminders(true); return; }   // cleared or refused
    list[+inp.dataset.at] = inp.value;
    saveTimes(list);
    openReminders(true);
  });

  $('#nRows').querySelectorAll('[data-drop]').forEach(b => b.onclick = () => {
    const list = (S.notifyTimes || []).slice();
    list.splice(+b.dataset.drop, 1);
    saveTimes(list);
    openReminders(true);
  });

  if($('#nAdd')) $('#nAdd').onclick = () => {
    const first = !(S.notifyTimes || []).length;
    saveTimes([...(S.notifyTimes || []), nextFreeTime()]);
    // The permission is asked for here and nowhere else: setting a time is the
    // only moment where the answer is obviously about something you just did.
    if(first && !st.canPost && Bridge && Bridge.requestNotifyPermission){
      try{ Bridge.requestNotifyPermission(); }catch(e){}
    }
    openReminders(true);
  };

  if($('#nPerm')) $('#nPerm').onclick = () => {
    try{ Bridge.requestNotifyPermission(); }catch(e){}
  };
  if($('#nSettings')) $('#nSettings').onclick = () => {
    try{ Bridge.openNotificationSettings(); }catch(e){}
  };

  /* Committed as it's typed, not on blur. The hardware back button takes the
     sheet away without ever blurring the field, and a change event that never
     fires is a message you wrote and lost. Blank falls back to the default
     rather than posting an empty notification. */
  let textTimer = null;
  const commitText = raw => {
    const next = (raw || '').trim() || notifyLimits().defaultText;
    if(next === S.notifyText) return;
    S.notifyText = next;
    persist();
    renderVault();
  };
  $('#nText').oninput = e => {
    clearTimeout(textTimer);
    const raw = e.target.value;
    textTimer = setTimeout(() => commitText(raw), 500);
  };
  $('#nText').onchange = e => {
    clearTimeout(textTimer);
    commitText(e.target.value);
    openReminders(true);            // canonical value back into the field
  };
  if($('#nReset')) $('#nReset').onclick = () => {
    S.notifyText = notifyLimits().defaultText;
    persist(); renderVault(); openReminders(true);
  };
}
