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
let snapshotCache = null;

/* Every load answers with a state, never a bare null. Three situations used
   to collapse into "there is no book", and seeding is only the right answer
   to one of them:

     missing     no file at all — a first run. Seed.
     ok          parsed; the book is in .doc.
     corrupt     read fine, didn't parse (truncated write, bad hand-edit).
     unreadable  the file is there and the shell couldn't read it (I/O,
                 permissions, full disk).

   The last two must never be seeded over: the bad file is the only evidence
   of what happened and may be partly salvageable. See boot(). */
const Store = {
  load(){
    if(!Bridge){
      // Preview mode: memory is the whole world, and it is never unreadable.
      if(memory == null) return { state:'missing' };
      try{ return { state:'ok', doc: typeof memory === 'string' ? JSON.parse(memory) : memory }; }
      catch(e){ return { state:'corrupt', error:String(e) }; }
    }
    // Older shells have no bookState(); there, an empty load() still means
    // "no book", exactly as it always did.
    const asked = typeof Bridge.bookState === 'function';
    let state;
    try{ state = asked ? Bridge.bookState() : 'ok'; }
    catch(e){ return { state:'unreadable', error:String(e) }; }
    if(state === 'missing') return { state:'missing' };
    if(state !== 'ok') return { state:'unreadable', error:'the shell could not read the file' };

    let raw;
    try{ raw = Bridge.load(); }
    catch(e){ return { state:'unreadable', error:String(e) }; }
    if(raw === '' || raw == null){
      // bookState() just said the file is there and readable, so an empty
      // answer from load() is a failure, not a first run.
      return asked ? { state:'unreadable', error:'the file read back empty' } : { state:'missing' };
    }
    try{ return { state:'ok', doc: typeof raw === 'string' ? JSON.parse(raw) : raw }; }
    catch(e){ return { state:'corrupt', error:String(e) }; }
  },

  save(doc){
    const raw = JSON.stringify(doc);
    snapshotCache = null;        // a save is what writes the day's snapshot
    if(Bridge) { try { Bridge.save(raw); } catch(e){ console.warn('save failed', e); } }
    else memory = raw;
  },

  /* The dated snapshots the shell keeps beside the book. Empty wherever the
     bridge doesn't offer them — preview, and shells older than this.

     Memoised, because answering means listing the folder and parsing every
     file in it to count spells, and renderVault() asks on every setting
     change. Only a save can add one, and that clears this. */
  snapshots(){
    if(snapshotCache) return snapshotCache;
    if(!Bridge || typeof Bridge.snapshots !== 'function') return [];
    try{
      const list = JSON.parse(Bridge.snapshots() || '[]');
      snapshotCache = Array.isArray(list) ? list : [];
    }catch(e){ snapshotCache = []; }
    return snapshotCache;
  },

  /* One snapshot back as text. '' if the name isn't one of ours. */
  readSnapshot(name){
    if(!Bridge || typeof Bridge.readSnapshot !== 'function') return '';
    try{ return Bridge.readSnapshot(name) || ''; }catch(e){ return ''; }
  },

  /* Put the current book beside the snapshots before something replaces it,
     so a mistaken restore is itself reversible. Returns the name written,
     or '' if there was nothing to keep or nowhere to keep it. */
  keepPreRestore(doc){
    if(!doc || !Bridge || typeof Bridge.preRestoreBackup !== 'function') return '';
    snapshotCache = null;        // this writes one too
    try{ return Bridge.preRestoreBackup(JSON.stringify(doc)) || ''; }catch(e){ return ''; }
  }
};
