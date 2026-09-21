'use strict';

// Integration tests intentionally launch the installed, pinned Chromium build.
// Run with: node --test /opt/browser/tests/runner.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { serve } = require('../runner.cjs');
const exec = promisify(execFile);
const runner = path.resolve(__dirname, '../runner.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-runner-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  const artifacts = path.join(root, 'artifacts');
  await fs.mkdir(workspace);
  await fs.writeFile(path.join(workspace, 'index.html'), '<!doctype html><title>Fixture</title><h1>Ready</h1>');
  return {
    root, workspace, artifacts,
    async run(script, overrides = {}) {
      const input = { root: true, browser: 'chromium', width: 800, height: 600, timeoutMs: 10000, script, fingerprint: 'test-fingerprint', ...overrides };
      const inputPath = path.join(root, 'input.json');
      await fs.writeFile(inputPath, JSON.stringify(input));
      const { stdout } = await exec(process.execPath, [runner, inputPath, workspace, artifacts], { timeout: 45000, maxBuffer: 1024 * 1024 });
      assert.equal(stdout.trim().split('\n').length, 1, 'stdout contains only one summary');
      const summary = JSON.parse(stdout);
      const result = JSON.parse(await fs.readFile(path.join(artifacts, 'results.json'), 'utf8'));
      return { summary, result };
    },
  };
}

async function evidence(dir) {
  const png = await fs.readFile(path.join(dir, 'screenshot.png'));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const trace = await fs.readFile(path.join(dir, 'trace.zip'));
  assert.equal(trace.subarray(0, 2).toString(), 'PK');
  assert.ok(trace.length > 100);
  for (const name of ['console.json', 'network.json', 'pageerrors.json']) assert.ok(Array.isArray(JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'))));
}

test('no automatic navigation; named checks, version, logs and artifacts', async t => {
  const f = await fixture(t);
  const { summary, result } = await f.run(`
    console.log('script logs must not pollute summary stdout');
    await check('initial page is blank', async () => assert.equal(page.url(), 'about:blank'));
    await page.goto(baseURL);
    await check('title', async () => await expect(page).toHaveTitle('Fixture'));
    await page.evaluate(() => {
      console.log('hello from page');
      setTimeout(() => { throw new Error('page error example'); }, 0);
    });
    await page.waitForTimeout(50);
    await context.route('**/broken', route => route.abort('failed'));
    await page.evaluate(() => fetch('/broken').catch(() => {}));
    await screenshot('named-evidence');
  `);
  assert.equal(summary.ok, true);
  assert.deepEqual(summary.counts, { total: 2, passed: 2, failed: 0 });
  assert.equal(summary.fingerprint, 'test-fingerprint');
  assert.equal(summary.playwrightVersion, '1.58.2');
  assert.ok(summary.browser.version);
  t.diagnostic(`Browser: ${summary.browser.name} ${summary.browser.version}; Playwright: ${summary.playwrightVersion}; fixture fingerprint: ${summary.fingerprint}`);
  assert.ok(result.console.some(event => event.source === 'page' && event.text === 'hello from page'));
  assert.ok(result.console.some(event => event.source === 'script' && event.text === 'script logs must not pollute summary stdout'));
  assert.ok(result.pageErrors.some(error => error.includes('page error example')));
  assert.ok(result.network.some(event => event.type === 'failed' && event.url.endsWith('/broken')));
  assert.ok(summary.artifacts.includes('named-evidence.png'));
  await evidence(f.artifacts);
  assert.deepEqual(await fs.readdir(f.workspace), ['index.html'], 'harness does not write into workspace');
});

test('CommonJS evidence and script console are retained with bounded summaries', async t => {
  const f = await fixture(t);
  const { summary, result } = await f.run(`
    const fs = require('node:fs/promises');
    const artifacts = ${JSON.stringify(f.artifacts)};
    await page.goto(baseURL);
    await fs.mkdir(artifacts + '/extra');
    await fs.writeFile(artifacts + '/extra/dom.html', await page.content());
    await fs.writeFile(artifacts + '/extra/accessibility.txt', await page.locator('body').ariaSnapshot());
    await fs.symlink(${JSON.stringify(f.workspace)}, artifacts + '/workspace-link');
    await screenshot('removed');
    await fs.unlink(artifacts + '/removed.png');
    console.log('formatted %s %d', 'message', 42);
    console.error('diagnostic', {detail: true});
    for (let i = 0; i < 25; i++) console.log('x'.repeat(1000));
  `);
  assert.equal(summary.ok, true, JSON.stringify(summary));
  assert.equal(summary.consoleMessages, 27);
  assert.equal(summary.console.length, 20);
  assert.equal(summary.omittedConsoleMessages, 7);
  assert.ok(summary.console.every(entry => entry.text.length <= 500));
  assert.equal(summary.console[0].text, 'formatted message 42');
  const consoleLog = JSON.parse(await fs.readFile(path.join(f.artifacts, 'console.json'), 'utf8'));
  assert.deepEqual(consoleLog, result.console);
  assert.ok(consoleLog.every(entry => entry.source === 'script'));
  assert.equal(consoleLog[1].type, 'error');
  assert.equal(consoleLog[1].text, 'diagnostic { detail: true }');
  assert.equal(consoleLog.at(-1).text.length, 1000);
  const expected = ['console.json', 'extra/accessibility.txt', 'extra/dom.html', 'network.json', 'pageerrors.json', 'results.json', 'screenshot.png', 'trace.zip'];
  assert.deepEqual(result.artifacts, expected);
  assert.deepEqual(summary.artifacts, expected);
  assert.match(await fs.readFile(path.join(f.artifacts, 'extra/dom.html'), 'utf8'), /<h1>Ready<\/h1>/);
  assert.match(await fs.readFile(path.join(f.artifacts, 'extra/accessibility.txt'), 'utf8'), /heading "Ready"/);
  assert.deepEqual(await fs.readdir(f.workspace), ['index.html']);
});

test('polling mock replacement updates data without losing DOM state; JSON stays text', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.workspace, 'index.html'), `<!doctype html>
    <style>body{height:3000px}#edit{position:fixed;top:10px}</style>
    <input id="edit" value="preserved input"><p id="data"></p>
    <script>
      window.documentIdentity = Math.random();
      setInterval(async () => {
        const response = await fetch('/api/poll');
        document.querySelector('#data').textContent = (await response.json()).value;
      }, 40);
    </script>`);
  const { summary } = await f.run(`
    await mock('**/api/poll', {json: {value: 'first'}});
    await page.goto(baseURL);
    await expect(page.locator('#data')).toHaveText('first');
    const identity = await page.evaluate(() => window.documentIdentity);
    await page.locator('#edit').focus();
    await page.evaluate(() => { document.querySelector('#edit').setSelectionRange(3, 7); scrollTo(0, 700); });
    await mock('**/api/poll', {json: {value: '<img src=x onerror="window.injected=true"> & "quoted"'}});
    await check('replacement is visible and escaped', async () => {
      await expect(page.locator('#data')).toHaveText('<img src=x onerror="window.injected=true"> & "quoted"');
      assert.equal(await page.locator('#data img').count(), 0);
      assert.equal(await page.evaluate(() => window.injected), undefined);
    });
    await check('DOM state survives fixture update', async () => {
      const state = await page.evaluate(() => ({ identity: window.documentIdentity, focus: document.activeElement.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd, scroll: scrollY }));
      assert.deepEqual(state, {identity, focus: 'edit', start: 3, end: 7, scroll: 700});
    });
  `);
  assert.equal(summary.ok, true, JSON.stringify(summary));
  assert.equal(summary.counts.passed, 2);
  await evidence(f.artifacts);
});

test('last mock wins, identical patterns replace, removal restores underlying route', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.workspace, 'api'));
  await fs.writeFile(path.join(f.workspace, 'api', 'value'), 'from server');
  await fs.writeFile(path.join(f.workspace, 'fixture.txt'), 'from file');
  const { summary } = await f.run(`
    await mock('**/api/**', {body: 'broad'});
    await mock('**/api/value', {body: 'specific', status: 201, headers: {'x-fixture': 'yes'}});
    await page.goto(baseURL);
    const get = () => page.evaluate(async () => { const r = await fetch('/api/value'); return {body: await r.text(), status: r.status, header: r.headers.get('x-fixture')}; });
    await check('specific last', async () => assert.deepEqual(await get(), {body: 'specific', status: 201, header: 'yes'}));
    await mock('**/api/**', {file: 'fixture.txt'});
    await check('broad replacement last', async () => assert.equal((await get()).body, 'from file'));
    await mock('**/api/**', null);
    await check('specific survives broad removal', async () => assert.equal((await get()).body, 'specific'));
    await mock('**/api/value', null);
    await check('server restored', async () => assert.equal((await get()).body, 'from server'));
  `);
  assert.equal(summary.ok, true, JSON.stringify(summary));
  assert.equal(summary.counts.passed, 4);
});

test('invalid replacements preserve mocks; registered headers and buffers are snapshots', async t => {
  const f = await fixture(t);
  const { summary } = await f.run(`
    const headers = {'x-fixture': 'original'};
    const body = Buffer.from('original');
    await mock('**/value', {body, headers});
    body.fill('x');
    headers['x-fixture'] = 'mutated';
    await page.goto(baseURL);
    await check('reject invalid status before replacing', async () => {
      for (const status of [0, 600, 200.5, '200']) await assert.rejects(mock('**/value', {body: 'bad', status}), /mock status/);
    });
    await check('reject invalid headers before replacing', async () => {
      for (const headers of [null, [], 'bad', {'x-fixture': 1}]) await assert.rejects(mock('**/value', {body: 'bad', headers}), /mock headers/);
    });
    await check('reject invalid payload before replacing', async () => {
      await assert.rejects(mock('**/value', {json: undefined}), /Invalid JSON/);
      await assert.rejects(mock('**/value', {file: 'missing.txt'}), /ENOENT/);
    });
    await check('original fixture survives', async () => {
      const value = await page.evaluate(async () => { const r = await fetch('/value'); return {body: await r.text(), header: r.headers.get('x-fixture')}; });
      assert.deepEqual(value, {body: 'original', header: 'original'});
    });
  `);
  assert.equal(summary.ok, true, JSON.stringify(summary));
  assert.equal(summary.counts.passed, 4);
});

test('assertion failures are results, continue execution, and retain evidence', async t => {
  const f = await fixture(t);
  const { summary } = await f.run(`
    await page.goto(baseURL);
    await check('reported failure', async () => assert.equal(1, 2));
    await check('still running', async () => assert.equal(2, 2));
  `);
  assert.equal(summary.ok, false);
  assert.deepEqual(summary.counts, { total: 2, passed: 1, failed: 1 });
  assert.equal(summary.checks[0].name, 'reported failure');
  assert.match(summary.checks[0].error, /AssertionError/);
  await evidence(f.artifacts);
});

test('malformed and throwing scripts are structured failures, not infrastructure errors', async t => {
  const f = await fixture(t);
  const { summary } = await f.run('await syntax error here');
  assert.equal(summary.ok, false);
  assert.match(summary.checks[0].error, /SyntaxError/);
  assert.equal(summary.infrastructureError, undefined);
  await evidence(f.artifacts);
  const second = await f.run('throw new Error("top-level failure")');
  assert.match(second.summary.checks[0].error, /top-level failure/);
  await evidence(f.artifacts);
});

test('hanging checks fail on deadline and close the browser', async t => {
  const f = await fixture(t);
  const started = Date.now();
  const { summary } = await f.run(`
    await check('never resolves', async () => await new Promise(() => {}));
  `, { timeoutMs: 300 });
  assert.equal(summary.ok, false);
  assert.ok(summary.checks.some(check => check.name === 'never resolves' && check.status === 'failed'));
  assert.match(JSON.stringify(summary.checks), /timed out/);
  assert.ok(Date.now() - started < 15000);
  await evidence(f.artifacts);
});

test('synchronous runaway is stopped by the process watchdog', async t => {
  const f = await fixture(t);
  const { summary, result } = await f.run(`
    await require('node:fs/promises').writeFile(${JSON.stringify(path.join(f.artifacts, 'before-timeout.txt'))}, 'saved');
    await screenshot('before-timeout');
    while (true) {}
  `, { timeoutMs: 1000 });
  assert.equal(summary.ok, false);
  assert.match(summary.checks.at(-1).error, /worker terminated/);
  assert.ok(result.captureErrors.some(error => error.includes('Forced termination')));
  assert.deepEqual(result.artifacts, (await fs.readdir(f.artifacts)).sort());
  assert.deepEqual(summary.artifacts, result.artifacts);
  assert.ok(result.artifacts.includes('before-timeout.txt'));
  assert.ok(result.artifacts.includes('before-timeout.png'));
});

test('static serving rejects traversal and symlink escapes, disables caching', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'secret.txt'), 'secret');
  await fs.symlink(path.join(f.root, 'secret.txt'), path.join(f.workspace, 'escape.txt'));
  await fs.symlink(f.root, path.join(f.workspace, 'escape-dir'));
  const server = await serve(f.workspace);
  t.after(() => server.close());
  const request = target => new Promise((resolve, reject) => {
    const req = http.get(`${server.baseURL}${target}`, res => {
      let body = '';
      res.setEncoding('utf8').on('data', data => { body += data; }).on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
  // Supply raw request paths: URL constructors would normalize literal ../.
  const raw = target => new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port: new URL(server.baseURL).port, path: target }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
  for (const target of ['/../secret.txt', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt', '/%5c..%5csecret.txt', '/escape.txt', '/escape-dir/secret.txt', '/%00', '/%ZZ']) assert.equal(await raw(target), 403, target);
  const good = await request('/');
  assert.equal(good.status, 200);
  assert.equal(good.headers['cache-control'], 'no-store');
  assert.match(good.headers['content-type'], /text\/html/);
  await fs.writeFile(path.join(f.workspace, 'index.html'), 'changed');
  assert.equal((await request('/')).body, 'changed');
});

test('fixture and artifact paths cannot escape their roots; ambiguous payload rejected', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'secret.txt'), 'secret');
  await fs.symlink(path.join(f.root, 'secret.txt'), path.join(f.workspace, 'escape.txt'));
  const { summary } = await f.run(`
    await check('parent fixture rejected', async () => await assert.rejects(mock('**/x', {file: '../secret.txt'}), /escapes workspace/));
    await check('symlink fixture rejected', async () => await assert.rejects(mock('**/x', {file: 'escape.txt'}), /escapes workspace/));
    await check('ambiguous fixture rejected', async () => await assert.rejects(mock('**/x', {body: 'x', json: {x: 1}}), /exactly one/));
    await check('screenshot path rejected', async () => await assert.rejects(screenshot('../workspace/nope'), /Unsafe screenshot name/));
    await check('absolute screenshot rejected', async () => await assert.rejects(screenshot('/tmp/nope'), /Unsafe screenshot name/));
  `);
  assert.equal(summary.ok, true, JSON.stringify(summary));
  assert.equal(summary.counts.passed, 5);
  assert.equal(await fs.readFile(path.join(f.root, 'secret.txt'), 'utf8'), 'secret');
});

test('existing URL mode and service-worker blocking', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.workspace, 'sw.js'), "self.addEventListener('fetch', event => event.respondWith(new Response('worker response')));");
  const server = await serve(f.workspace);
  t.after(() => server.close());
  const { summary } = await f.run(`
    await check('existing URL', async () => { await page.goto(baseURL); await expect(page).toHaveTitle('Fixture'); });
    await page.evaluate(() => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
    await page.waitForTimeout(100);
    await check('service workers blocked', async () => assert.equal(context.serviceWorkers().length, 0));
    await mock('**/intercepted', {body: 'route response'});
    await check('route is not intercepted by worker', async () => assert.equal(await page.evaluate(() => fetch('/intercepted').then(r => r.text())), 'route response'));
  `, { root: false, url: server.baseURL });
  assert.equal(summary.ok, true, JSON.stringify(summary));
});
