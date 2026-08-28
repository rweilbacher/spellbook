/* Spellbook · store.js
   Storage — the Android bridge, or memory in preview.
   Loaded by index.html before the inline script. Plain script, shared
   globals — no imports, no build step. Order does not matter among these. */

/* =========================================================================
   Storage — the Android bridge is the real one. In a plain browser we keep
   state in memory so the app is fully explorable, just not persistent.
   ========================================================================= */
const Bridge = window.Android && typeof window.Android.save === 'function' ? window.Android : null;
let memory = null;

const Store = {
  load(){
    try{
      const raw = Bridge ? Bridge.load() : memory;
      return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    }catch(e){ console.warn('load failed', e); return null; }
  },
  save(doc){
    const raw = JSON.stringify(doc);
    if(Bridge) { try { Bridge.save(raw); } catch(e){ console.warn('save failed', e); } }
    else memory = raw;
  }
};
