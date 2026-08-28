/* Spellbook · sheet.js
   The bottom sheet.
   Loaded by index.html before the inline script. Plain script, shared
   globals — no imports, no build step. Order does not matter among these. */

/* =========================================================================
   Sheet
   ========================================================================= */
function sheet(title, html, onClose, keep){
  if(!keep) closeSheet();
  else {
    const b = document.querySelector('.sheet .body');
    // Swapping the body in place keeps the sheet from re-animating; the
    // title has to follow it or a recorder still reads 'Notes'.
    if(b){
      const t = document.querySelector('.sheet .top .eyebrow');
      if(t) t.textContent = title;
      b.innerHTML = html;
      return;
    }
    closeSheet();
  }
  const scrim = document.createElement('div');
  scrim.className = 'scrim'; scrim.onclick = closeSheet;
  const el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = `<div class="grab"></div>
    <div class="top"><span class="eyebrow">${esc(title)}</span>
    <button class="act" onclick="closeSheet()"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="body">${html}</div>`;
  document.body.append(scrim, el);
  sheet._onClose = onClose;
}
function closeSheet(){
  // Dismissing the sheet mid-recording throws it away; the file would
  // otherwise be written with no note ever pointing at it.
  if(rec){ rec = null; try{ Bridge.cancelVoiceNote(); }catch(e){} }
  stopPlayback();
  document.querySelectorAll('.scrim,.sheet').forEach(n=>n.remove());
  if(sheet._onClose){ const f = sheet._onClose; sheet._onClose = null; f(); }
}
window.closeSheet = closeSheet;
