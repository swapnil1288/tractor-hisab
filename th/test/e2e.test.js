/* End-to-end: drives the real mobile UI in Chromium against a real server + PostgreSQL. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { makePool, migrate } = require('../server/db');
const { createApp } = require('../server/app');
const pdf = require('../server/pdf');

const DB = process.env.E2E_DATABASE_URL || 'postgres://th:th@localhost:5432/th_e2e';
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, '..', 'docs', 'screenshots');
let pool, server, base, browser;
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
const q = (sql, a) => pool.query(sql, a).then(r => r.rows);
async function synced(page) { await page.waitForFunction(() => window.__th && window.__th.S.outbox.length === 0 && !window.__th.S.syncing, null, { timeout: 15000 }); await page.waitForTimeout(150); }
const heroOut = page => page.locator('.hero .hero-a').first().innerText();

test.before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  pool = makePool(DB); await pool.query('drop schema public cascade; create schema public;'); await migrate(pool);
  const app = createApp({ pool, env: { NODE_ENV: 'test', OTP_PROVIDER: 'dev', SESSION_SECRET: 'e2e', REGISTER_LIMIT_PER_HOUR: '1000' } });
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); }); base = `http://localhost:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
});
test.after(async () => { await browser.close(); server.close(); await pdf.close(); await pool.end(); });

test('owner end-to-end on a phone', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, locale: 'mr-IN', timezoneId: 'Asia/Kolkata', bypassCSP: true });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await page.goto(base + '/'); await page.waitForSelector('#authF');
  await shot(page, '01-login');
  // ---- register
  await page.click('#authSwitch');
  await page.fill('[name=businessName]', 'ओमकार ट्रॅक्टर सेवा'); await page.fill('[name=ownerName]', 'ओमकार पाटील'); await page.fill('[name=village]', 'चाकण');
  await page.fill('[name=mobile]', '9822000001'); await page.fill('[name=password]', 'owner-pass-1');
  await page.click('#authF button[type=submit]');
  // ---- setup wizard
  await page.waitForSelector('#bn'); await page.fill('#bu', 'omkar@upi'); await shot(page, '02-setup-business'); await page.click('#sn');
  assert.equal(await page.inputValue('#tn'), 'ओमकार सोनालिका'); await page.click('#sn');
  await page.waitForSelector('#implList'); await shot(page, '03-setup-implements'); await page.click('#sn');
  await page.waitForSelector('.cta.work'); await synced(page);
  const impls = await q('select name, rate_paise from implements order by created_at');
  assert.deepEqual(impls.map(i => [i.name, i.rate_paise]), [['नागर', 120000], ['सिंगल पलटी नागर', 110000], ['रोटर', 120000], ['फणी', 100000], ['सरी', 80000], ['सारे', 80000], ['पेरणी', 80000], ['बारीक रोटर', 90000]]);
  // ---- add farmer with two named farms and optional mobile
  await page.click('[data-act=quick]'); await page.click('#qf');
  await page.fill('#fn', 'रमेश जाधव'); await page.fill('#fv', 'पिंपळगाव'); await page.fill('#fm', '9876500001'); await page.fill('#ff', 'विहिरीजवळचे, ओढ्याकडचे');
  await page.click('#save'); await page.waitForSelector('.prof'); await synced(page);
  assert.equal((await q('select count(*)::int n from farms'))[0].n, 2);
  // ---- historical work: 80 min at ₹1200/h = ₹1600.00
  await page.click('.act3 [data-act=work]'); await page.waitForSelector('[data-mode=past]');
  await page.click('[data-farm]:has-text("ओढ्याकडचे")'); await page.click('[data-im]:has-text("नागर") >> nth=0');
  await page.click('[data-mode=past]');
  await page.fill('#startT', '08:00'); await page.fill('#endT', '09:20'); await page.waitForTimeout(80);
  assert.equal(await page.innerText('#ftA'), '₹1,600.00'); await shot(page, '04-work-historical');
  await page.click('#save'); await page.waitForSelector('#ok'); await shot(page, '05-confirm-charge');
  assert.match(await page.innerText('.kvl'), /₹1,600\.00/);
  await page.click('#ok'); await synced(page);
  assert.equal((await q("select count(*)::int n, sum(amount_paise)::bigint s from ledger_entries where kind='charge'"))[0].s, 160000);
  // ---- invalid input feedback: end before start
  await page.click('.act3 [data-act=work]'); await page.click('[data-mode=past]'); await page.fill('#startT', '10:00'); await page.fill('#endT', '09:00'); await page.waitForTimeout(60);
  assert.match(await page.innerText('#pv'), /सुरुवातीनंतर/); await page.click('#save'); assert.match(await page.innerText('#err'), /सुरुवातीनंतर/);
  await page.click('[data-close]');
  // ---- live: book → start (clock set 2h 0m ago) → finish with 15 min break at ₹1200/h = ₹2100.00
  await page.click('.act3 [data-act=work]'); await page.click('[data-im]:has-text("रोटर") >> nth=0'); await page.click('[data-mode=book]'); await page.click('#save'); await synced(page);
  await page.clock.setFixedTime(new Date(Date.now() - 120 * 60000));
  await page.click('.row[data-act=job]:has-text("रोटर")', { timeout: 5000 }); await page.click('#go'); await synced(page);
  await page.clock.setFixedTime(new Date()); await page.goto(base + '/'); await page.waitForSelector('.running');
  await shot(page, '06-home-running');
  await page.click('[data-act=finish]'); await page.fill('#brk', '15'); await page.waitForTimeout(80);
  const live = await page.innerText('#ftA'); assert.equal(live, '₹2,100.00', '120 min − 15 min break at ₹1200/h');
  await page.click('#save'); await page.waitForSelector('#ok'); await page.click('#ok'); await synced(page);
  assert.equal(await heroOut(page), '₹3,700.00', '₹1600 + ₹2100');
  await page.click('[data-go=farmer]'); await page.waitForSelector('.act3');
  // ---- payments: partial, then advance; outstanding and credit shown separately
  const owedBefore = (await q('select sum(amount_paise)::bigint s from ledger_entries'))[0].s;
  await page.click('.act3 [data-act=pay]'); await page.fill('#pa', '1000'); await page.waitForTimeout(50);
  await shot(page, '07-payment'); await page.click('#save'); await synced(page);
  assert.equal(await heroOut(page), require('../server/billing').formatPaise(owedBefore - 100000));
  const rest = (await q('select sum(amount_paise)::bigint s from ledger_entries'))[0].s;
  await page.click('.act3 [data-act=pay]'); await page.fill('#pa', String(rest / 100 + 500)); await page.click('[data-m=upi]'); await page.fill('#ref', 'UPI778'); await page.click('#save'); await synced(page);
  assert.equal(await heroOut(page), '₹0.00'); assert.match(await page.locator('.hero .hero-a').nth(1).innerText(), /₹500\.00/);
  await shot(page, '08-farmer-credit');
  // ---- double tap on save records one payment
  const nPay = (await q('select count(*)::int n from payments'))[0].n;
  await page.click('.act3 [data-act=pay]'); await page.fill('#pa', '50');
  await page.locator('#save').dblclick().catch(() => {}); await synced(page);
  assert.equal((await q('select count(*)::int n from payments'))[0].n, nPay + 1, 'double tap → exactly one payment');
  assert.equal(await page.locator('.prof').count(), 1, 'second tap did not leak through to the page underneath'); await page.waitForTimeout(500);
  // ---- offline entry, reload while offline, reconnect, sync once
  await ctx.setOffline(true);
  await page.click('.act3 [data-act=pay]'); await page.fill('#pa', '200'); await page.click('#save'); await page.waitForTimeout(200);
  assert.match(await page.innerText('#syncb'), /ऑफलाइन/); await shot(page, '09-offline-pending');
  await page.reload(); await page.waitForSelector('.cta.work', { timeout: 10000 });
  assert.equal(await page.evaluate(() => window.__th.S.outbox.length), 1, 'pending entry survived reload');
  await ctx.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online'))); await synced(page);
  await page.evaluate(() => window.dispatchEvent(new Event('online'))); await synced(page);
  assert.equal((await q("select count(*)::int n from payments where amount_paise=20000"))[0].n, 1, 'synced exactly once');
  await page.click('.nav [data-go=farmers]'); await page.click('#fl .row'); await page.waitForSelector('.act3');
  // ---- statement: create + download real PDF; balances unchanged
  const balBefore = (await q('select sum(amount_paise)::bigint s from ledger_entries'))[0].s;
  await page.click('.act3 [data-act=statements]'); await page.waitForSelector('#mk');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#mk')]);
  const pdfPath = path.join(SHOTS, 'statement.pdf'); await dl.saveAs(pdfPath);
  assert.equal(fs.readFileSync(pdfPath).subarray(0, 4).toString(), '%PDF');
  await page.waitForSelector('[data-dl]'); await shot(page, '10-statements');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-dl]')]); assert.ok(await dl2.path(), 'reprint downloads');
  assert.equal((await q('select sum(amount_paise)::bigint s from ledger_entries'))[0].s, balBefore);
  await page.click('[data-close]');
  // ---- concurrent edit from a second phone → conflict state, then resolved
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true }); const p2 = await ctx2.newPage(); await p2.route(/fonts\./, r => r.abort());
  await p2.goto(base + '/'); await p2.fill('[name=mobile]', '9822000001'); await p2.fill('[name=password]', 'owner-pass-1'); await p2.click('#authF button[type=submit]'); await p2.waitForSelector('.cta.work');
  await p2.click('[data-go=farmers]'); await p2.click('#fl .row'); await p2.click('[data-act=editFarmer]'); await p2.fill('#fv', 'खेड'); await p2.click('#save'); await synced(p2);
  await page.click('[data-act=editFarmer]'); await page.fill('#fv', 'चाकण'); await page.click('#save');
  await page.waitForFunction(() => window.__th.S.outbox.some(o => o.status === 'conflict'));
  assert.match(await page.innerText('#syncb'), /संघर्ष/);
  await page.click('#syncb'); await shot(page, '11-conflict'); await page.click('[data-rebase]'); await synced(page);
  assert.equal((await q('select village from farmers'))[0].village, 'चाकण', 'owner chose to re-apply their change');
  await page.click('[data-close]'); await ctx2.close();
  // ---- Hindi labels
  await page.click('[data-go=more]'); await page.click('main [data-lang=hi]'); await page.waitForTimeout(100);
  assert.match(await page.innerText('.nav'), /किसान/); await shot(page, '12-more-hindi');
  await page.click('main [data-lang=mr]'); await synced(page);
  await page.click('[data-go=home]'); await shot(page, '13-home');
  // ---- logout clears private cache
  await page.click('[data-go=more]'); await page.click('[data-act=logout]'); await page.click('#ok'); await page.waitForSelector('#authF');
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('th:') && k !== 'th:lang'));
  assert.deepEqual(keys, [], 'no private data left on the phone');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('farmer portal with OTP shows the same balance (read-only)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, acceptDownloads: true, timezoneId: 'Asia/Kolkata', bypassCSP: true });
  const page = await ctx.newPage(); await page.route(/fonts\./, r => r.abort());
  await page.goto(base + '/farmer'); await page.fill('#fm', '9876500001'); await page.click('#ff button'); await page.waitForSelector('#oc');
  const code = (await page.innerText('.sms')).match(/\d{6}/)[0]; await page.fill('#oc', '000000' === code ? '111111' : '000000'); await page.click('#ff button');
  assert.match(await page.innerText('#err'), /चुकीचा/);
  await page.fill('#oc', code); await page.click('#ff button'); await page.waitForSelector('.hero');
  const owner = (await q('select sum(amount_paise)::bigint s from ledger_entries'))[0].s;
  const credit = await page.locator('.hero .hero-a').nth(1).innerText();
  assert.equal(credit, require('../server/billing').formatPaise(Math.max(0, -owner)));
  await shot(page, '14-farmer-portal');
  const before = (await q('select count(*)::int n from statements'))[0].n;
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#fpdf')]); assert.ok(await dl.path());
  await page.fill('#q', 'मागील महिन्याचे बिल पाठवा'); await page.click('#qs'); await page.waitForTimeout(300);
  assert.equal((await q('select count(*)::int n from statements'))[0].n, before, 'farmer download saved nothing');
  assert.equal((await q('select count(*)::int n from farmer_questions'))[0].n, 1);
  await ctx.close();
});
