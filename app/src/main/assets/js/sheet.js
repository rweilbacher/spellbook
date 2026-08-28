/* Spellbook · sheet.js
   The bottom sheet.
   Loaded by index.html before the inline script. Plain script, shared
   globals — no imports, no build step. Order does not matter among these. */

/* =========================================================================
   Sheet

   A sheet has a name and a title, and they are two different things: the
   name is how code identifies it, the title is the copy on screen.
   window.onNative used to match on the title text — rename "Reminders" and
   the notification-permission refresh silently stopped working — so the
   name goes into data-sheet and nothing reads the words any more.

     sheet('reminders', 'Reminders', html, { keep:true })

   opt.keep swaps the body of the open sheet in place instead of animating a
   new one in. opt.onClose runs when the sheet closes, whatever closed it.
   ========================================================================= */
let sheetOnClose = null;

function sheet(name, title, html, opt = {}){
  if(opt.keep){
    const body = document.querySelector('.sheet .body');
    // Swapping the body in place keeps the sheet from re-animating; the
    // title and the name have to follow it or a recorder still reads 'Notes'.
    if(body){
      const open = document.querySelector('.sheet');
      open.dataset.sheet = name;
      const t = open.querySelector('.top .eyebrow');
      if(t) t.textContent = title;
      body.innerHTML = html;
      return;                 // the open sheet keeps its own onClose
    }
  }
  closeSheet();

  const scrim = document.createElement('div');
  scrim.className = 'scrim'; scrim.onclick = closeSheet;
  const el = document.createElement('div');
  el.className = 'sheet';
  el.dataset.sheet = name;
  el.innerHTML = `<div class="grab"></div>
    <div class="top"><span class="eyebrow">${esc(title)}</span>
    <button class="act" data-close="1"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="body">${html}</div>`;
  el.querySelector('[data-close]').onclick = closeSheet;
  document.body.append(scrim, el);
  sheetOnClose = opt.onClose || null;
}

/* Which sheet is open, by name. '' when none is. */
function openSheetName(){
  const el = document.querySelector('.sheet');
  return el ? (el.dataset.sheet || '') : '';
}

function closeSheet(){
  // Dismissing the sheet mid-recording throws it away; the file would
  // otherwise be written with no note ever pointing at it.
  if(rec){ rec = null; try{ Bridge.cancelVoiceNote(); }catch(e){} }
  stopPlayback();
  document.querySelectorAll('.scrim,.sheet').forEach(n=>n.remove());
  if(sheetOnClose){ const f = sheetOnClose; sheetOnClose = null; f(); }
}
