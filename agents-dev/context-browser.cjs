'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const {chromium, expect} = require('@playwright/test');
const read = (dir, file) => fs.readFile(`/fixtures/${dir}/${file}`, 'utf8');
const gistID = 'abcdef0123456789abcdef0123456789';
const gistURL = 'https://gistpreview.github.io/?' + gistID;
const apiURL = 'https://api.github.com/gists/' + gistID;
const rawURL = 'https://gist.githubusercontent.com/example/' + gistID + '/raw/context.json';

test('JSON-backed Context exports', {timeout: 180000}, async t => {
  const server = http.createServer(async (req, res) => {
    const match = /^\/(dynamic|offline|large|selected)\/(index\.html|questions\.html|context\.json)$/.exec(req.url);
    if (!match) { res.writeHead(404); res.end('not found'); return; }
    try { res.setHeader('Content-Type', match[2].endsWith('.json') ? 'application/json' : 'text/html'); res.end(await read(match[1], match[2])); }
    catch (_) { res.writeHead(404); res.end('not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {value: {writeText: async text => { window.copied = text; }}});
  });
  // No live network dependency, including links or malicious fixture payloads.
  await context.route('**/*', route => /^(file:\/\/\/fixtures\/|http:\/\/127\.0\.0\.1:)/.test(route.request().url()) ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const ready = async () => { await expect(page.locator('h1')).toBeVisible(); assert.deepEqual(errors, []); };
  const html = selector => page.locator(selector).evaluateAll(es => es.map(e => e.outerHTML));
  const ids = selector => page.locator(selector).evaluateAll(es => es.map(e => e.id));
  const doc = JSON.parse(await read('dynamic', 'context.json'));
  const urgent = doc.blocks.find(b => b.id === 'questions/urgent');
  const title = /data-title="([^"]*)"/.exec(await read('dynamic', 'questions.html'))[1];
  assert.ok(title.includes('&lt;'));
  try {
    await t.test('HTTP rendering matches offline cards, links and curated sections', async () => {
      for (const file of ['index.html', 'questions.html']) {
        await page.goto(`${origin}/offline/${file}`); await ready();
        const cards = await html('.blk'), nav = await html('nav'), matrix = await html('.matrix'), filters = await html('.filters');
        await page.goto(`${origin}/dynamic/${file}`); await ready();
        assert.deepEqual(await html('.blk'), cards);
        assert.deepEqual(await html('nav'), nav);
        assert.deepEqual(await html('.matrix'), matrix);
        assert.deepEqual(await html('.filters'), filters);
        assert.equal(await page.evaluate(() => window.pwned), undefined);
        assert.equal(await page.locator('main script, main img, a[href^="javascript:"]').count(), 0);
        assert.ok((await page.title()).includes('</script>'));
      }
      assert.deepEqual(await ids('section.q'), ['q-questions/urgent', 'q-questions/blocker-a', 'q-questions/blocker-b', 'q-questions/pinned', 'q-questions/later', 'q-questions/legacy']);
      await expect(page.locator('section.q .rec')).toHaveCount(2);
      await page.goto(`${origin}/dynamic/index.html#b-notes/dropped`); await ready();
      await expect(page.locator('#dropped + .sub + details')).toHaveAttribute('open');
      await expect(page.locator('[id="b-notes/dropped"]')).toBeVisible();
      await expect(page.locator('[id="b-questions/foreign"]')).toHaveCount(1);
      await page.locator('button[data-f="kind"][data-v="fact"]').click();
      assert.equal(await page.locator('#blocks-list .blk:not(.hide)').count(), 2);
      await page.locator('button[data-f="tag"]').filter({hasText: 'colon: inside'}).click();
      assert.equal(await page.locator('#blocks-list .blk:not(.hide)').count(), 0);
      await page.locator('button[data-f="all"]').click();
      assert.equal(await page.locator('#blocks-list .blk.hide').count(), 0);
      await page.goto(`${origin}/selected/questions.html`); await ready();
      assert.deepEqual(await ids('section.q'), ['q-questions/urgent']);
    });
    await t.test('ordinary HTTP choices/notes persist and prompts retain Q-number and stable id', async () => {
      await page.goto(`${origin}/dynamic/questions.html`); await ready();
      const card = page.locator('[id="q-questions/urgent"]');
      await card.locator('input[value="B"]').check();
      await card.locator('textarea').fill('Please wait.\nCheck first.');
      await page.reload(); await ready();
      await expect(card.locator('input[value="B"]')).toBeChecked();
      await expect(card.locator('textarea')).toHaveValue('Please wait.\nCheck first.');
      await page.locator('#gen').click();
      const prompt = await page.locator('#prompt').inputValue();
      assert.ok(prompt.includes(`- Q-${urgent.number} (questions/urgent) → B — No & wait. Notes: Please wait. Check first.`));
      assert.ok(prompt.includes('superseding the question by its id'));
      await card.locator('button.copy').click();
      assert.equal(await page.evaluate(() => window.copied), prompt);
      await page.locator('#copy-all').click();
      assert.equal(await page.evaluate(() => window.copied), prompt);
      page.once('dialog', dialog => dialog.accept());
      await page.locator('#clear').click();
      await page.reload(); await ready();
      await expect(card.locator('input[value="B"]')).not.toBeChecked();
      await expect(card.locator('textarea')).toHaveValue('');
      await card.locator('a.bid').click(); await ready();
      assert.equal(page.url(), `${origin}/dynamic/index.html#b-questions/urgent`);
    });
    async function gist(file) {
      await page.route('https://gistpreview.github.io/**', async route => {
        const question = route.request().url().includes('/questions.html');
        await route.fulfill({contentType: 'text/html', body: await read('dynamic', question ? 'questions.html' : 'index.html')});
      });
      await page.route(apiURL, route => route.fulfill({json: {files: {'context.json': file}}}));
    }
    await t.test('gist inline JSON, correct cross-page URLs and same storage identity', async () => {
      await gist({truncated: false, content: JSON.stringify(doc), raw_url: rawURL});
      await page.goto(gistURL + '/questions.html'); await ready();
      const bodyTitle = await page.locator('body').getAttribute('data-title');
      const key = `context-answers:${gistID}:${bodyTitle}`;
      await page.evaluate(({key, urgent}) => localStorage.setItem(key, JSON.stringify({'questions/urgent': {choice: 'B', text: urgent.options[1].text, notes: 'old page answer'}})), {key, urgent});
      await page.reload(); await ready();
      await expect(page.locator('[id="q-questions/urgent"] input[value="B"]')).toBeChecked();
      await expect(page.locator('[id="q-questions/urgent"] textarea')).toHaveValue('old page answer');
      await page.locator('[id="q-questions/urgent"] a.bid').click(); await ready();
      assert.equal(page.url(), gistURL + '/index.html#b-questions/urgent');
      await page.locator('nav a').filter({hasText: 'Answer questions'}).click(); await ready();
      assert.equal(page.url(), gistURL + '/questions.html');
      await expect(page.locator('[id="q-questions/urgent"] input[value="B"]')).toBeChecked();
      const changed = structuredClone(doc);
      changed.blocks.find(b => b.id === urgent.id).options[1].text = 'Different answer';
      await page.route(apiURL, route => route.fulfill({json: {files: {'context.json': {content: JSON.stringify(changed)}}}}));
      await page.reload(); await ready();
      await expect(page.locator('[id="q-questions/urgent"] input[value="B"]')).not.toBeChecked();
      await page.locator('#gen').click();
      assert.ok((await page.locator('#prompt').inputValue()).includes('no option picked. Notes: old page answer'));
    });
    await t.test('truncated or missing inline content uses complete raw JSON', async () => {
      const large = await read('large', 'context.json');
      assert.ok(Buffer.byteLength(large) > 921600);
      let fetches = 0;
      await page.route(rawURL, route => { fetches++; return route.fulfill({contentType: 'application/json', body: large}); });
      for (const file of [{content: large.slice(0, 200), truncated: true, raw_url: rawURL}, {raw_url: rawURL}]) {
        await gist(file);
        await page.goto(gistURL); await ready();
        const expected = JSON.parse(large).blocks.find(b => b.id === 'notes/large').text;
        await expect(page.locator('[id="b-notes/large"] p')).toHaveText(expected);
      }
      assert.equal(fetches, 2);
    });
    await t.test('failed fetches and malformed documents never leave partial cards', async () => {
      const bad = structuredClone(doc); bad.blocks[bad.blocks.length - 1].options = [{key:'A', text:123}];
      const cases = [
        [{files: {}}, 'no context.json'],
        [{files: {'context.json': {truncated: true}}}, 'raw_url'],
        [{files: {'context.json': {truncated: true, raw_url:'https://attacker.example/data'}}}, 'raw_url'],
        [{files: {'context.json': {content:'{"blocks":['}}}, 'invalid or incomplete'],
        [{files: {'context.json': {content:JSON.stringify({version:2, blocks:[]})}}}, 'unsupported version'],
        [{files: {'context.json': {content:JSON.stringify(bad)}}}, 'Invalid Context schema'],
      ];
      for (const [json, message] of cases) {
        await page.route(apiURL, route => route.fulfill({json}));
        await page.goto(gistURL + '/questions.html');
        await expect(page.getByRole('alert')).toContainText(message);
        await expect(page.getByRole('alert')).toContainText('offlineHtml: true');
        assert.equal(await page.locator('.blk, input[type=radio]').count(), 0);
      }
      await page.route(apiURL, route => route.fulfill({status:403, json:{message:'rate limit'}}));
      await page.goto(gistURL); await expect(page.getByRole('alert')).toContainText('HTTP 403');
      await page.route(apiURL, route => route.abort());
      await page.goto(gistURL); await expect(page.getByRole('alert')).toContainText('Unable to load Context');
      await gist({truncated: true, raw_url:rawURL});
      await page.route(rawURL, route => route.fulfill({status:404, body:'missing'}));
      await page.goto(gistURL); await expect(page.getByRole('alert')).toContainText('HTTP 404');
      await page.route(rawURL, route => route.fulfill({body:'{"blocks":['}));
      await page.goto(gistURL); await expect(page.getByRole('alert')).toContainText('Invalid or incomplete JSON');
      await page.route('**/dynamic/context.json', route => route.fulfill({status:404, body:'missing'}));
      await page.goto(`${origin}/dynamic/index.html`); await expect(page.getByRole('alert')).toContainText('HTTP 404');
      await page.goto('file:///fixtures/dynamic/index.html'); await expect(page.getByRole('alert')).toContainText('file://');
      await page.goto('file:///fixtures/offline/questions.html'); await ready();
      await expect(page.locator('section.q')).toHaveCount(6);
      assert.deepEqual(errors, []);
    });
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
