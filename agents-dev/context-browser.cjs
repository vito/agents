'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const {chromium, expect} = require('@playwright/test');
const read = (dir, file) => fs.readFile(`/fixtures/${dir}/${file}`, 'utf8');
const gistID = 'abcdef0123456789abcdef0123456789';
const viewerOrigin = 'https://vito.github.io';
const viewerPath = '/agents/context/v1/';
const gistURL = viewerOrigin + viewerPath + '?gist=' + gistID;
const apiURL = 'https://api.github.com/gists/' + gistID;
const rawURL = 'https://gist.githubusercontent.com/example/' + gistID + '/raw/context.json';

test('JSON-backed Context exports', {timeout: 180000}, async t => {
  let redirectJSON = false;
  const server = http.createServer(async (req, res) => {
    if (redirectJSON && req.url === '/dynamic/context.json') {
      res.writeHead(302, {location: './data.json'}); res.end(); return;
    }
    if (redirectJSON && req.url === '/dynamic/data.json') {
      if (!(req.headers.cookie || '').includes('context-auth=allowed')) {
        res.writeHead(401); res.end('authentication required'); return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(await read('dynamic', 'context.json')); return;
    }
    const match = /^\/(dynamic|offline|large|selected|pins|pins-offline)\/([a-z-]+\.(?:html|json|js|css))$/.exec(req.url);
    if (!match) { res.writeHead(404); res.end('not found'); return; }
    const mime = {json: 'application/json', html: 'text/html', js: 'text/javascript', css: 'text/css'};
    try { res.setHeader('Content-Type', mime[match[2].split('.').pop()]); res.end(await read(match[1], match[2])); }
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
  const title = /<title>(.*?)<\/title>/.exec(await read('dynamic', 'questions.html'))[1];
  assert.ok(title.includes('&lt;'));
  try {
    await t.test('portable and hosted views ship identical shared assets', async () => {
      for (const asset of ['context.css', 'render.js', 'interactions.js', 'boot.js']) {
        assert.equal(await read('dynamic', asset), await read('viewer', asset));
        assert.equal(await read('dynamic', asset), await read('large', asset));
      }
    });
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
    await t.test('pin cost and overload warning agree in dynamic and offline views', async () => {
      let expected;
      for (const dir of ['pins-offline', 'pins']) {
        await page.goto(`${origin}/${dir}/index.html`); await ready();
        await expect(page.locator('.legend')).toContainText('candidates for bounded orientation');
        await expect(page.locator('.legend')).not.toContainText('composed into every turn');
        await expect(page.locator('.pin-cost')).toHaveText('Active pinned body text: 16400 character(s), excluding headers, summaries and options.');
        await expect(page.locator('.pin-warning')).toContainText('unpin historical milestones with blockPin rather than deleting their records');
        const actual = await html('.legend, .pin-cost, .pin-warning');
        if (expected) assert.deepEqual(actual, expected);
        expected = actual;
      }
      for (const dir of ['offline', 'dynamic']) {
        await page.goto(`${origin}/${dir}/index.html`); await ready();
        await expect(page.locator('.pin-warning')).toHaveCount(0);
        await expect(page.locator('.pin-cost')).toHaveCount(1);
      }
    });
    await t.test('portable HTTP follows JSON redirects and retains same-origin cookies', async () => {
      await context.addCookies([{name: 'context-auth', value: 'allowed', url: origin}]);
      redirectJSON = true;
      try {
        for (const view of ['index.html', 'questions.html']) {
          await page.goto(`${origin}/dynamic/${view}`); await ready();
          await expect(page.locator('.blk').first()).toBeVisible();
        }
      } finally {
        redirectJSON = false;
        await context.clearCookies();
      }
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
      // Answers saved on a page from before titles were required ("Context")
      // carry over to its retitled re-export at the same path.
      await page.evaluate(() => { localStorage.clear(); localStorage.setItem('context-answers:' + location.pathname + ':Context', JSON.stringify({'questions/urgent': {notes: 'from an untitled export'}})); });
      await page.reload(); await ready();
      await expect(card.locator('textarea')).toHaveValue('from an untitled export');
      await page.evaluate(() => localStorage.clear());
      await card.locator('a.bid').click(); await ready();
      assert.equal(page.url(), `${origin}/dynamic/index.html#b-questions/urgent`);
    });
    // Serve the actual built Pages files, independently of anything in the gist.
    await page.route(viewerOrigin + viewerPath + '**', async route => {
      const file = new URL(route.request().url()).pathname.slice(viewerPath.length) || 'index.html';
      const mime = {html: 'text/html', js: 'text/javascript', css: 'text/css'};
      await route.fulfill({contentType: mime[file.split('.').pop()], body: await read('viewer', file)});
    });
    async function gist(file) {
      await page.route(apiURL, route => route.fulfill({json: {files: {'context.json': file,
        'index.html': {content: '<script>window.pwned=1</script>'},
        'context.js': {content: 'window.pwned=1'}
      }}}));
    }
    await t.test('landing page accepts gist IDs and URLs without fetching arbitrary hosts', async () => {
      await gist({content: JSON.stringify(doc)});
      for (const input of [gistID, 'https://gist.github.com/example/' + gistID]) {
        await page.goto(viewerOrigin + viewerPath);
        await page.getByLabel('Gist ID or URL').fill(input);
        await page.getByRole('button', {name: 'Open Context'}).click();
        await ready();
        assert.equal(page.url(), gistURL);
      }
      await page.goto(viewerOrigin + viewerPath);
      await page.getByLabel('Gist ID or URL').fill('https://attacker.example/' + gistID);
      await page.getByRole('button', {name: 'Open Context'}).click();
      await expect(page.locator('#gist-error')).toBeVisible();
      assert.equal(page.url(), viewerOrigin + viewerPath);
      await page.goto(viewerOrigin + viewerPath + '?gist=invalid');
      await expect(page.getByRole('alert')).toContainText('gist');
    });
    await t.test('hosted inline JSON, correct cross-view URLs and answer persistence', async () => {
      await gist({truncated: false, content: JSON.stringify(doc), raw_url: rawURL});
      await page.goto(gistURL + '&view=questions'); await ready();
      assert.equal(await page.evaluate(() => window.pwned), undefined);
      await expect(page.locator('section.q')).toHaveCount(6);
      await page.locator('[id="q-questions/urgent"] input[value="B"]').check();
      await page.locator('[id="q-questions/urgent"] textarea').fill('old page answer');
      await page.reload(); await ready();
      await expect(page.locator('[id="q-questions/urgent"] input[value="B"]')).toBeChecked();
      await expect(page.locator('[id="q-questions/urgent"] textarea')).toHaveValue('old page answer');
      await page.locator('[id="q-questions/urgent"] a.bid').click(); await ready();
      assert.equal(page.url(), gistURL + '#b-questions/urgent');
      await page.locator('nav a').filter({hasText: 'Answer questions'}).click(); await ready();
      assert.equal(page.url(), gistURL + '&view=questions');
      await expect(page.locator('[id="q-questions/urgent"] input[value="B"]')).toBeChecked();
      const changed = structuredClone(doc);
      changed.blocks.find(b => b.id === urgent.id).options[1].text = 'Different answer';
      await page.route(apiURL, route => route.fulfill({json: {files: {'context.json': {content: JSON.stringify(changed)}}}}));
      await page.reload(); await ready();
      await expect(page.locator('[id="q-questions/urgent"] input[value="B"]')).not.toBeChecked();
      await page.locator('#gen').click();
      assert.ok((await page.locator('#prompt').inputValue()).includes('no option picked. Notes: old page answer'));
    });
    await t.test('hosted metadata, legacy defaults, deep links and gist isolation', async () => {
      await gist({content: JSON.stringify(doc)});
      await page.goto(gistURL + '#b-notes/dropped'); await ready();
      await expect(page.locator('#dropped + .sub + details')).toHaveAttribute('open');
      await expect(page.locator('[id="b-notes/dropped"]')).toBeVisible();
      assert.equal(await page.title(), doc.viewer.title);
      await expect(page.locator('#glance + .blk')).toContainText('decisions/x');
      await expect(page.locator('#glance + .blk + .blk')).toContainText('questions/urgent');
      const otherID = '123456789abcdef0123456789abcdef0';
      await page.route('https://api.github.com/gists/' + otherID, route => route.fulfill({json: {files: {'context.json': {content: JSON.stringify(doc)}}}}));
      await page.goto(viewerOrigin + viewerPath + '?gist=' + otherID + '&view=questions'); await ready();
      await expect(page.locator('[id="q-questions/urgent"] textarea')).toHaveValue('');
      await expect(page.locator('[id="q-questions/urgent"] input[value="B"]')).not.toBeChecked();
      const legacy = structuredClone(doc); delete legacy.viewer;
      await gist({content: JSON.stringify(legacy)});
      await page.goto(gistURL + '&view=questions'); await ready();
      await expect(page.locator('section.q')).toHaveCount(7); // old exports lack ownership metadata
      await expect(page.locator('[id="q-questions/foreign"]')).toBeVisible();
      assert.ok((await page.title()).startsWith('Context'));
      // Untitled or generically titled exports take the gist's description;
      // a real title always wins over it.
      const described = (content, description) => page.route(apiURL, route => route.fulfill({json: {description, files: {'context.json': {content: JSON.stringify(content)}}}}));
      const generic = structuredClone(doc); generic.viewer.title = 'Context';
      for (const content of [legacy, generic]) {
        await described(content, '  Release <b>prep</b>  ');
        await page.goto(gistURL + '&view=questions'); await ready();
        assert.equal(await page.title(), 'Release <b>prep</b> — open questions');
        await expect(page.locator('h1')).toHaveText('Release <b>prep</b> — open questions');
        assert.equal(await page.locator('h1 b').count(), 0);
      }
      await described(doc, 'Release prep');
      await page.goto(gistURL); await ready();
      assert.equal(await page.title(), doc.viewer.title);
    });
    await t.test('dark mode follows the system color scheme', async () => {
      const colors = () => page.evaluate(() => {
        const css = el => getComputedStyle(document.querySelector(el));
        return {bg: css('body').backgroundColor, fg: css('body').color, card: css('.blk').backgroundColor, button: css('button').backgroundColor};
      });
      const luminance = rgb => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      for (const url of [`${origin}/dynamic/questions.html`, `${origin}/offline/index.html`, gistURL]) {
        if (url === gistURL) await gist({content: JSON.stringify(doc)});
        await page.emulateMedia({colorScheme: 'light'});
        await page.goto(url); await ready();
        const light = await colors();
        await page.emulateMedia({colorScheme: 'dark'});
        const dark = await colors();
        assert.ok(luminance(light.bg) > 200 && luminance(dark.bg) < 60, `${url}: ${light.bg} → ${dark.bg}`);
        assert.ok(luminance(dark.fg) > 180 && luminance(dark.card) < 60, `${url}: ${dark.fg} on ${dark.card}`);
        assert.notEqual(light.button, dark.button);
      }
      await page.emulateMedia({colorScheme: 'light'});
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
      const invalidViewers = [
        {...doc.viewer, version: 2}, {...doc.viewer, title: {}},
        {...doc.viewer, ownQuestions: ['facts/current']},
        {...doc.viewer, lead: ['missing/id']},
        {...doc.viewer, repo: 'javascript:alert(1)'},
      ];
      for (const viewer of invalidViewers) {
        cases.push([{files: {'context.json': {content: JSON.stringify({...doc, viewer})}}}, 'viewer']);
      }
      for (const [json, message] of cases) {
        await page.route(apiURL, route => route.fulfill({json}));
        await page.goto(gistURL + '&view=questions');
        await expect(page.getByRole('alert')).toContainText(message);
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
