/**
 * Spellbook smoke test.
 *
 * The app is a web page, so it can be driven headlessly without building an
 * APK. This serves app/src/main/assets/ and runs the real index.html in
 * Chromium with no Android bridge — which is exactly the "preview mode" the
 * app already supports (Bridge === null, state in memory, no recording).
 *
 *   cd tools && npm install && cd ..
 *   node tools/smoke.mjs
 *
 * Exits non-zero on any failure, so it drops straight into CI.
 * Whole run is about seven seconds, most of it Chromium starting up.
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] || path.join(HERE, '..', 'app', 'src', 'main', 'assets');

// Served over http rather than opened as file:// — closer to the real
// https://appassets.androidplatform.net origin, and it keeps working if the
// script is ever split into modules.
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // Some Chromium builds ask for a favicon; a 404 for it would fail the
  // console-hygiene check for a reason that has nothing to do with the app.
  if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const f = path.join(ROOT, url);
  fs.readFile(f, (e, d) => e ? (res.writeHead(404), res.end()) : (res.writeHead(200), res.end(d)));
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

const noise = [];
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok || !detail ? '' : '  → ' + detail}`);
};

// ------------------------------------------------------------ syntax
/* Before starting a browser: a syntax error anywhere in the JS would show up
   below as a wall of unrelated failures, or — for the inline block, which
   fails silently and leaves boot() uncalled — as a hang. Parsing costs
   milliseconds and names the file. */
for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter(n => n.endsWith('.js'))) {
  let err = '';
  try { new vm.Script(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')); }
  catch (e) { err = e.message; }
  check(`js/${f} parses`, !err, err);
}
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let err = '';
  try { inline.forEach(src => new vm.Script(src)); }
  catch (e) { err = e.message; }
  check("index.html's inline script parses", inline.length > 0 && !err, err);
}

// SMOKE_CHROMIUM lets a machine with Chromium already on disk (CI images, the
// sandbox this is sometimes run in) skip `npx playwright install`.
const browser = await chromium.launch(
  process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') noise.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => noise.push(`pageerror: ${e.message}`));

await page.goto(base);
await page.waitForFunction(() => typeof doc !== 'undefined' && Array.isArray(doc.spells));

// ---------------------------------------------------------------- boot
const n = await page.evaluate(() => doc.spells.length);
check('book seeds from window.SEED', n > 0, `got ${n} spells`);
check('seed covers every situation', await page.evaluate(() => {
  const have = new Set(doc.spells.flatMap(s => s.tags));
  return SITUATIONS.filter(t => !have.has(t));
}).then(missing => missing.length === 0, () => false));
check('seed covers the form tags', await page.evaluate(() => {
  const have = new Set(doc.spells.flatMap(s => s.tags));
  return ['practice', 'prompt', 'flagged', 'inbox'].every(t => have.has(t));
}));
check('seed covers the computed tags', await page.evaluate(() => {
  const all = new Set(doc.spells.filter(s => s.state === 'active').flatMap(tagsOf));
  return ['question', 'untagged', 'useful'].every(t => all.has(t));
}));
check('seed includes buried spells', await page.evaluate(() => buried().length) > 0);
check('seed includes both note types', await page.evaluate(() => {
  const kinds = new Set(doc.spells.flatMap(s => (s.notes || []).map(x => x.type)));
  return kinds.has('text') && kinds.has('voice');
}));
check('desk starts empty (no baked timestamps to rot)',
  await page.evaluate(() => doc.spells.every(s => !s.desked)));

// ---------------------------------------------------------------- the draw
const drawnBefore = await page.evaluate(() => doc.spells.reduce((n, s) => n + s.drawn, 0));
await page.click('#sigilBtn');
await page.waitForSelector('#results .card', { timeout: 5000 });
check('cast reveals a card', await page.locator('#results .card').count() === 1);
check('draw enters revealed state', await page.locator('#draw.revealed').count() === 1);
const drawnAfter = await page.evaluate(() => doc.spells.reduce((n, s) => n + s.drawn, 0));
check('cast increments drawn by exactly one', drawnAfter === drawnBefore + 1,
  `${drawnBefore} → ${drawnAfter}`);

// ---------------------------------------------------------- quick actions
await page.click('#results .card [data-act="useful"]');
check('useful mark persists', await page.evaluate(() => doc.spells.some(s => s.useful > 0)));
check('useful strips the inbox tag', await page.evaluate(() =>
  !doc.spells.find(s => s.useful > 0).tags.includes('inbox')));

await page.click('#results .card [data-act="desk"]');
check('desk pin sets a timestamp', await page.evaluate(() => doc.spells.some(s => s.desked)));

await page.click('#results .card [data-act="source"]');
check('source panel opens', await page.locator('#results .card .source:not(.hide)').count() === 1);

// ---------------------------------------------------------------- notes
await page.click('#results .card [data-act="note"]');
await page.fill('#nText', 'smoke test note');
await page.click('#nSave');
check('note lands on the spell', await page.evaluate(() =>
  doc.spells.some(s => (s.notes || []).some(x => x.text === 'smoke test note'))));

// ------------------------------------------------------------ every tab
for (const tab of ['desk', 'library', 'tags', 'vault', 'draw']) {
  await page.click(`nav button[data-tab="${tab}"]`);
  const visible = await page.locator(`#${tab}:not(.hide)`).count();
  const len = await page.locator(`#${tab}`).evaluate(el => el.innerText.trim().length);
  check(`tab "${tab}" renders`, visible === 1 && len > 0, `visible=${visible} textlen=${len}`);
}

// --------------------------------------------------------------- filters
await page.click('nav button[data-tab="draw"]');
await page.click('#filterChip');
await page.waitForSelector('.sheet');
const before = await page.evaluate(() => pool().length);
await page.click('#fSitu [data-t]');
const after = await page.evaluate(() => pool().length);
check('picking a situation narrows the pool', after < before, `${before} → ${after}`);
await page.click('#fClear');
check('clear restores the pool', await page.evaluate(() => pool().length) === before);

// ---------------------------------------------------------------- search
await page.click('nav button[data-tab="library"]');
await page.fill('#search', 'zzzzznotathing');
check('empty search state renders', await page.locator('#libList .empty').count() === 1);
await page.fill('#search', '');

// ------------------------------------------------------- the back contract
await page.click('nav button[data-tab="vault"]');
check('appBack leaves vault for draw', await page.evaluate(() => window.appBack()) === true);
check('appBack from bare draw yields to Android', await page.evaluate(() => window.appBack()) === false);

// ------------------------------------------------------- pure functions
// These are the ones reimplemented in Kotlin (see docs/bridge.md). A change
// here that the widget doesn't get is the most likely way to break this app.
check('fmt renders the three markup forms', await page.evaluate(() =>
  fmt('a **b** c *d* e ==f==') === 'a <b>b</b> c <em>d</em> e <i class="mk">f</i>'));
check('cleanTimes sorts, dedupes and caps at three', await page.evaluate(() =>
  JSON.stringify(cleanTimes(['22:00', '09:00', '09:00', '13:00', '07:30', 'nope', '25:00']))
    === JSON.stringify(['07:30', '09:00', '13:00'])));
check('weightOf multiplies inbox and flagged', await page.evaluate(() => {
  const s = { text: 'x', tags: ['inbox', 'flagged'], useful: 0 };
  return weightOf(s) === (S.inboxWeight * S.flaggedWeight);
}));

// ------------------------------------------------------ awkward content
// The seed carries these on purpose; this is what it is for.
check('markup renders as bold / italic / highlight', await page.evaluate(() => {
  const h = fmt('**a** *b* ==c==');
  return h.includes('<b>a</b>') && h.includes('<em>b</em>') && h.includes('<i class="mk">c</i>');
}));
check('HTML metacharacters are escaped, not interpreted', await page.evaluate(() => {
  const s = doc.spells.find(x => x.text.includes('<like this>'));
  if (!s) return false;
  const h = fmt(s.text);
  return h.includes('&lt;like this&gt;') && h.includes('&amp;') && !h.includes('<like');
}));
check('long text gets the small size class', await page.evaluate(() =>
  doc.spells.some(s => s.text.length > 300) &&
  sizeClass(doc.spells.find(s => s.text.length > 300).text) === 'sm'));
check('short text gets the large size class', await page.evaluate(() =>
  sizeClass('Watch your feet.') === 'lg'));
check('multi-line text survives intact', await page.evaluate(() =>
  doc.spells.some(s => s.text.includes('\n'))));
check('non-ASCII survives intact', await page.evaluate(() =>
  doc.spells.some(s => /[äöüàéâ’—]/.test(s.text))));
check('graveyard is browsable', await (async () => {
  return await page.evaluate(() => { libGrave = true; libTag = null; go('library'); return true; });
})() && await page.locator('#libList .row.gone').count() > 0);
await page.evaluate(() => { libGrave = false; go('draw'); });

// ---------------------------------------------------------- CSS integrity
// A later @keyframes silently replaces an earlier one of the same name.
const dupes = await page.evaluate(() => {
  const seen = {}, dup = [];
  for (const sheet of document.styleSheets) {
    let rules;
    // Reading cssRules on a cross-origin sheet throws; serve over http, not file://
    try { rules = sheet.cssRules; } catch { return ['<stylesheet unreadable>']; }
    for (const r of rules)
      if (r.type === CSSRule.KEYFRAMES_RULE) seen[r.name] ? dup.push(r.name) : seen[r.name] = 1;
  }
  return dup;
});
check('no duplicate @keyframes', dupes.length === 0, dupes.join(', '));

// -------------------------------------------------------- console hygiene
check('console is clean', noise.length === 0, noise.join(' | '));
await page.close();

// ===================================================== behind the bridge
/* Everything above ran with Bridge === null — most of the app, but none of
   the paths that decide whether your book survives. This installs a
   scriptable stand-in for the Android bridge before the page boots, so
   load() can be told to answer with a real book, garbage, or a failure, and
   every save is recorded rather than written.
   Each scenario gets its own page: boot() runs once, and once is the point. */

// Runs in the page, before any of the app's own scripts.
function installFake(opts){
  const state = { book: opts.book ?? '', mode: opts.mode || 'ok', snaps: opts.snaps || {}, saves: [], pre: [] };
  window.__fake = state;
  window.Android = {
    bookState(){ if(state.mode === 'throws') throw new Error('bookState blew up'); return state.mode; },
    load(){ return state.book; },
    save(json){ state.saves.push(json); state.book = json; },
    snapshots(){
      return JSON.stringify(Object.keys(state.snaps).map(name => {
        let spells = -1;
        try{ spells = JSON.parse(state.snaps[name]).spells.length; }catch(e){}
        return { name, at: Date.now(), bytes: state.snaps[name].length, spells };
      }));
    },
    readSnapshot(name){ return state.snaps[name] || ''; },
    preRestoreBackup(json){ state.pre.push(json); return 'pre-restore-20260828-101010.json'; },
    openRequest(){ return ''; },
    mediaList(){ return '[]'; },
    pruneMedia(){ return 0; },
    bluetoothMicAvailable(){ return false; },
    backupInfo(){ return JSON.stringify({ set:false, label:'', lastAt:0 }); },
    notifyState(){ return JSON.stringify({ canPost:true, max:3, defaultText:'The book is open. Where are you?' }); },
    export(){ return 'Downloads'; }
  };
}

const spell = (over = {}) => Object.assign({
  id: 'sp_' + Math.random().toString(16).slice(2, 10), text: 'A spell.', tags: ['stuck'],
  useful: 0, drawn: 0, lastDrawn: null, state: 'active', desked: null, notes: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  source: { origin: 'import', note: null, file: null, line: null, url: null, capturedAt: null }
}, over);

const aBook = (over = {}) => JSON.stringify(Object.assign({
  version: 2, exportedAt: '2026-08-01T00:00:00.000Z', inboxSeeded: true,
  settings: { notifyTimes: ['07:30'], notifyText: 'Wake up', inboxWeight: 5,
              tagKindOverrides: { brass: 'situation' }, drawCount: 3 },
  spells: [
    spell({ id: 'sp_keep', text: 'A spell with a history.', useful: 4, drawn: 9,
            lastDrawn: '2026-07-01T00:00:00.000Z' }),
    spell({ id: 'sp_gone', text: 'A buried spell.', state: 'graveyard', tags: [] })
  ]
}, over));

async function withBridge(opts){
  const p = await browser.newPage({ viewport: { width: 412, height: 915 } });
  const junk = [];
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') junk.push(`${m.type()}: ${m.text()}`); });
  p.on('pageerror', e => junk.push(`pageerror: ${e.message}`));
  await p.addInitScript(installFake, opts);
  await p.goto(base);
  await p.waitForFunction(() => window.__booted === true);
  return { p, junk, saves: () => p.evaluate(() => window.__fake.saves) };
}

// -------------------------------------------------- a book that is there
{
  const { p, junk, saves } = await withBridge({ mode: 'ok', book: aBook() });
  check('an existing book is not seeded over',
    await p.evaluate(() => doc.spells.length) === 2);
  check('its counts survive the boot',
    await p.evaluate(() => doc.spells.find(s => s.id === 'sp_keep').drawn) === 9);
  check('its settings survive the boot',
    await p.evaluate(() => S.notifyText) === 'Wake up');
  check('a current book boots without a single write', (await saves()).length === 0,
    `${(await saves()).length} saves`);
  check('no console noise behind the bridge', junk.length === 0, junk.join(' | '));
  await p.close();
}

// ----------------------------------------------- an older book migrates
{
  const { p, saves } = await withBridge({
    mode: 'ok', book: aBook({ version: 1, inboxSeeded: undefined,
      spells: [spell({ id: 'sp_old', text: 'From before the inbox.', desked: undefined })] })
  });
  check('a version-1 book runs its migrations',
    await p.evaluate(() => doc.spells[0].tags.includes('inbox') && doc.spells[0].desked === null));
  check('and comes out stamped with the current schema',
    await p.evaluate(() => doc.version === SCHEMA && SCHEMA === 2));
  check('five migrations still cost exactly one write', (await saves()).length === 1,
    `${(await saves()).length} saves`);
  await p.close();
}

// --------------------------------------------------------- no book yet
{
  const { p, saves } = await withBridge({ mode: 'missing' });
  check('a first run seeds', await p.evaluate(() => doc.spells.length === SEED.length));
  check('and writes the seeded book once', (await saves()).length === 1,
    `${(await saves()).length} saves`);
  await p.close();
}

// ------------------------------------------- the book that will not open
for (const [label, opts] of [
  ['a truncated book', { mode: 'ok', book: '{"version":2,"spells":[{"id":"sp_a","te' }],
  ['an unreadable book', { mode: 'unreadable', book: '' }],
  ['a bridge that throws', { mode: 'throws' }],
  ['a book that reads back empty', { mode: 'ok', book: '' }],
  ['a book with no spells left', { mode: 'ok', book: aBook({ spells: [] }) }]
]) {
  const { p, saves } = await withBridge(opts);
  check(`${label} shows the recovery screen`,
    await p.locator('#recovery:not(.hide)').count() === 1);
  check(`${label} is never written over`, (await saves()).length === 0,
    `${(await saves()).length} saves`);
  await p.close();
}

// --------------------------------------------------- restore, end to end
{
  const good = aBook();
  const { p, junk, saves } = await withBridge({
    mode: 'ok', book: '{"spells":[trunc', snaps: { 'spellbook-2026-08-27.json': good }
  });
  check('recovery lists the snapshots it found',
    await p.locator('#recovery [data-rsnap]').count() === 1);
  // The month name follows the device locale, so this asserts the shape:
  // a readable date, not the filename.
  check('recovery names the day the copy is from', await (async () => {
    const label = await p.locator('#recovery [data-rsnap] .lab').first().innerText();
    return label.includes('2026') && !label.includes('.json');
  })());
  await p.click('#recovery [data-rsnap]');
  await p.waitForSelector('.sheet');
  check('restore asks first, and says what it will replace',
    (await p.locator('.sheet .body').innerText()).includes('replaces the book'));
  check('and nothing is written while it is asking', (await saves()).length === 0);
  await p.click('#rsGo');
  await p.waitForFunction(() => document.querySelector('#recovery').classList.contains('hide'));
  check('restore brings the useful count back',
    await p.evaluate(() => doc.spells.find(s => s.id === 'sp_keep').useful) === 4);
  check('restore brings the draw count back',
    await p.evaluate(() => doc.spells.find(s => s.id === 'sp_keep').drawn) === 9);
  check('restore brings the graveyard back',
    await p.evaluate(() => doc.spells.find(s => s.id === 'sp_gone').state) === 'graveyard');
  check('restore brings the reminder times back — F1.4',
    await p.evaluate(() => JSON.stringify(S.notifyTimes)) === '["07:30"]');
  check('restore brings tagKindOverrides back — F1.4',
    await p.evaluate(() => S.tagKindOverrides.brass) === 'situation');
  check('a restored book is written once', (await saves()).length === 1,
    `${(await saves()).length} saves`);
  check('the app comes back after a restore',
    await p.locator('#app:not(.hide)').count() === 1 && await p.locator('#draw:not(.hide)').count() === 1);
  check('restoring over an unreadable book keeps nothing pre-restore',
    (await p.evaluate(() => window.__fake.pre)).length === 0);
  check('the recovery path leaves the console clean', junk.length === 0, junk.join(' | '));
  await p.close();
}

// ------------------------------------------ restore over a working book
{
  const { p, saves } = await withBridge({ mode: 'ok', book: aBook() });
  await p.evaluate(book => { restoreDoc(book, 'a file'); },
    aBook({ spells: [spell({ id: 'sp_new', text: 'Only this one.' })] }));
  check('a restore over a live book keeps it as a pre-restore copy first',
    (await p.evaluate(() => window.__fake.pre)).length === 1);
  check('and the pre-restore copy is the book as it was',
    JSON.parse((await p.evaluate(() => window.__fake.pre))[0]).spells.length === 2);
  check('the restored book replaced the old one',
    await p.evaluate(() => doc.spells.length === 1 && doc.spells[0].id === 'sp_new'));
  check('a restore writes once', (await saves()).length === 1);
  await p.close();
}

// ----------------------------------------------------------- the merge
{
  const { p } = await withBridge({ mode: 'ok', book: aBook() });
  await p.evaluate(incoming => { mergeSpells(incoming); }, JSON.stringify({
    spells: [
      spell({ id: 'sp_keep', text: 'A spell with a history.', useful: 1, drawn: 20 }),
      spell({ id: 'sp_gone', text: 'A buried spell.', state: 'active' }),
      spell({ id: 'sp_fresh', text: 'Someone else\'s spell.' })
    ]
  }));
  check('a merge never lowers a count — F1.3',
    await p.evaluate(() => doc.spells.find(s => s.id === 'sp_keep').useful) === 4);
  check('a merge raises a count the other book has seen more of',
    await p.evaluate(() => doc.spells.find(s => s.id === 'sp_keep').drawn) === 20);
  check('a merge never resurrects a buried spell — F1.3',
    await p.evaluate(() => doc.spells.find(s => s.id === 'sp_gone').state) === 'graveyard');
  check('a merged-in spell arrives in the inbox',
    await p.evaluate(() => doc.spells.find(s => s.id === 'sp_fresh').tags.includes('inbox')));
  check('a merge leaves settings alone — they belong to this phone',
    await p.evaluate(() => S.notifyText) === 'Wake up');
  await p.close();
}

// ------------------------------- the constants Kotlin owns (R6 · #5, #6)
/* notifyState() has always sent the cap and the default wording across.
   The page used to keep its own copies; now it reads what it's told, and
   this proves it by having the bridge answer with something else. */
{
  const { p } = await withBridge({ mode: 'missing' });
  await p.evaluate(() => {
    window.Android.notifyState = () => JSON.stringify(
      { canPost: true, max: 2, defaultText: 'Kotlin decides the wording' });
    notifyLimitsCache = null;
  });
  check('the reminder cap comes from the bridge, not a second constant',
    await p.evaluate(() => cleanTimes(['07:00', '09:00', '13:00']).length) === 2);
  check('and so does the default wording',
    await p.evaluate(() => notifyLimits().defaultText) === 'Kotlin decides the wording');
  await p.close();
}

// ------------------------------------------ one way to redraw a card
/* patchCard replaced two drifting implementations. What's local to the
   element and not to the spell has to survive it. */
{
  const { p } = await withBridge({ mode: 'ok', book: aBook() });
  await p.click('#sigilBtn');
  await p.waitForSelector('#results .card');
  await p.click('#results .card [data-act="source"]');
  await p.click('#results .card [data-act="useful"]');
  check('a patched card keeps its source panel open',
    await p.locator('#results .card .source:not(.hide)').count() === 1);
  check('a patched card shows the new count',
    (await p.locator('#results .card [data-act="useful"] .n').innerText()).trim() === '5');
  check('a patched card does not replay its entrance',
    await p.locator('#results .card.rise').count() === 0);
  await p.close();
}

// ------------------------------------------ the snapshots, from the vault
{
  const { p } = await withBridge({
    mode: 'ok', book: aBook(),
    snaps: { 'spellbook-2026-08-27.json': aBook(), 'pre-restore-20260826-091500.json': aBook() }
  });
  await p.click('nav button[data-tab="vault"]');
  await p.click('#vSnaps');
  await p.waitForSelector('.sheet');
  check('the vault lists every snapshot', await p.locator('.sheet [data-snap]').count() === 2);
  check('a pre-restore copy says what it is',
    (await p.locator('.sheet [data-snap]').nth(1).innerText()).includes('Before a restore'));
  await p.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
