/* Spellbook · backup.js
   The backup folder you pick once.
   Loaded by index.html before the inline script. Plain script, shared
   globals — no imports, no build step. Order does not matter among these. */

/* ---------- the backup folder ----------
   The weekly JSON drop into Downloads was insurance built when the book was
   the only thing worth insuring. Recordings changed that. Pick a folder once
   and the book and its audio are copied there daily; point that folder at
   something a sync app already mirrors and the offsite copy costs nothing
   here. Nothing changes if you never pick one. */
/* Whether there's a headset to record through this second — so the toggle
   in the Vault can say what it will actually do if you use it now. */
function headsetNow(){
  if(!Bridge || !Bridge.bluetoothMicAvailable) return false;
  try{ return !!Bridge.bluetoothMicAvailable(); }catch(e){ return false; }
}

function backupInfo(){
  if(!Bridge || !Bridge.backupInfo) return {set:false, label:'', lastAt:0};
  try{ return JSON.parse(Bridge.backupInfo() || '{}'); }
  catch(e){ return {set:false, label:'', lastAt:0}; }
}

function openBackupFolder(bk){
  if(!Bridge || !Bridge.pickBackupFolder){ toast('Backups need the app'); return; }
  const when = bk.lastAt
    ? 'Last copied ' + noteTime(new Date(bk.lastAt).toISOString())
    : 'Nothing copied there yet';
  sheet('Backup folder', `
    <p class="help" style="margin-top:0">${bk.set
      ? `The book and every recording are copied into <b>${esc(bk.label)}</b> once a day, riding along on an ordinary save. ${esc(when)}.`
      : `Pick a folder and the book and its recordings get copied there once a day. Choose one a sync app already watches and it reaches your cloud with nothing more to set up.<br><br>Until then a weekly copy of the book alone goes to Downloads.`}</p>
    <button class="btn" id="bkPick">${bk.set ? 'Choose a different folder' : 'Choose a folder'}</button>
    ${bk.set ? `<button class="btn ghost" id="bkNow">Back up now</button>
      <button class="btn danger" id="bkClear">Stop backing up there</button>` : ''}
  `);
  $('#bkPick').onclick = () => { closeSheet(); try{ Bridge.pickBackupFolder(); }catch(e){} };
  if($('#bkNow')) $('#bkNow').onclick = () => {
    let out = {ok:false, message:'The backup didn\'t finish'};
    try{ out = JSON.parse(Bridge.backupNow(JSON.stringify(doc)) || '{}'); }catch(e){}
    closeSheet(); renderVault(); toast(out.message || (out.ok ? 'Backed up' : 'The backup didn\'t finish'));
  };
  if($('#bkClear')) $('#bkClear').onclick = () => {
    try{ Bridge.clearBackupFolder(); }catch(e){}
    closeSheet(); renderVault(); toast('Backups go to Downloads again');
  };
}
