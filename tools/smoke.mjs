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
check('book seeds from SEED', n > 0, `got ${n} spells`);

// ---------------------------------------------------------------- the draw
await page.click('#sigilBtn');
await page.waitForSelector('#results .card', { timeout: 5000 });
check('cast reveals a card', await page.locator('#results .card').count() === 1);
check('draw enters revealed state', await page.locator('#draw.revealed').count() === 1);
check('cast increments drawn',
  await page.evaluate(() => doc.spells.filter(s => s.drawn > 0).length) === 1);

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

// ---------------------------------------------------------- CSS integrity
// A later @keyframes silently replaces an earlier one of the same name.
const dupes = await page.evaluate(() => {
  const seen = {}, dup = [];
  for (const sheet of document.styleSheets)
    for (const r of sheet.cssRules)
      if (r.type === CSSRule.KEYFRAMES_RULE) seen[r.name] ? dup.push(r.name) : seen[r.name] = 1;
  return dup;
});
check('no duplicate @keyframes', dupes.length === 0, dupes.join(', '));

// -------------------------------------------------------- console hygiene
check('console is clean', noise.length === 0, noise.join(' | '));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
