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
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] || path.join(HERE, '..', 'app', 'src', 'main', 'assets');

// Served over http rather than opened as file:// — closer to the real
// https://appassets.androidplatform.net origin, and it keeps working if the
// script is ever split into modules.
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
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

const browser = await chromium.launch();
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

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
