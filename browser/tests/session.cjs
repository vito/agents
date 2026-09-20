'use strict';

// Integration tests use the prepared container's real, pinned Chromium. The
// application and endpoints are synthetic fixtures, not live-backend coverage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { controller, Events } = require('../session.cjs');
const { client, packageSource } = require('../client.cjs');
const exec = promisify(execFile);

const html = `<!doctype html><title>Session fixture</title>
<style>body{height:2500px}#filter{position:fixed;top:8px}</style>
<input id="filter" value="persistent filter"><details id="panel" open><summary>Panel</summary>Contents</details><p id="data"></p>
<script>window.identity = Math.random();setInterval(async () => {
  const value = await fetch('/poll').then(r => r.json()).catch(() => ({value:'unavailable'}));
  document.querySelector('#data').textContent = value.value;
}, 70);</script>`;

async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-session-'));
  const workspace = path.join(root, 'workspace');
  const observations = path.join(root, 'observations');
  await fs.mkdir(workspace);
  await fs.writeFile(path.join(workspace, 'index.html'), html);
  await fs.writeFile(path.join(workspace, 'fixture.txt'), 'original fixture');
  await fs.writeFile(path.join(workspace, 'deleted.txt'), 'delete me');
  const token = 'test-control-token-not-for-pages';
  const service = await controller({ session: 'test-session', token, root: true, browser: 'chromium', width: 800, height: 600, fingerprint: 'source-v1', ...overrides }, { workspace, observations, port: 0, host: '127.0.0.1' });
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  let counter = 0;
  return {
    root, workspace, observations, token, service,
    async request(command, extraHeaders = {}) {
      const response = await fetch(`${service.endpoint}/command`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify({ id: `obs-${++counter}`, expectedInstance: service.instanceID, ...command }) });
      const text = await response.text();
      if (!response.ok) throw new Error(`${response.status}: ${text}`);
      return JSON.parse(text);
    },
    async file(id, name) {
      const response = await fetch(`${service.endpoint}/artifact?id=${encodeURIComponent(id)}&path=${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
      return Buffer.from(await response.arrayBuffer());
    },
    async result(envelope) { return JSON.parse(await fs.readFile(path.join(observations, envelope.observation, 'results.json'), 'utf8')); },
  };
}

const passes = envelope => assert.equal(envelope.summary.ok, true, JSON.stringify(envelope.summary));

async function navigate(f) {
  const result = await f.request({ op: 'exec', script: `await assert.equal(page.url(), 'about:blank'); await mock('**/poll', {json: {value:'first'}}); await page.goto(baseURL); await expect(page.locator('#data')).toHaveText('first');` });
  passes(result);
  return result;
}

test('state and fixture routes persist across separate exec, inspect, sync and stop calls', async t => {
  const f = await fixture(t);
  const status = await f.request({ op: 'status' });
  assert.equal(status.summary.state, 'running');
  assert.equal(status.summary.loadedFingerprint, null);
  assert.equal(status.summary.playwrightVersion, '1.58.2');
  assert.ok(status.summary.browser.version);
  t.diagnostic(`Browser: ${status.summary.browser.name} ${status.summary.browser.version}; Playwright: ${status.summary.playwrightVersion}; source fingerprint: ${status.summary.fingerprint}`);
  const first = await navigate(f);
  const firstBytes = await f.file(first.observation, 'screenshot.png');
  const firstJSON = await f.file(first.observation, 'results.json');
  assert.equal(firstBytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal((await f.file(first.observation, 'trace.zip')).subarray(0, 2).toString(), 'PK');
  const prepare = await f.request({ op: 'exec', script: `
    await mock('**/frozen', {file: 'fixture.txt'});
    const scriptLocal = 'not retained';
    await page.locator('#filter').fill('custom filter');
    await page.evaluate(() => { document.querySelector('#panel').open = false; document.querySelector('#filter').setSelectionRange(2,6); scrollTo(0,700); window.savedIdentity = window.identity; });
    await require('node:fs/promises').writeFile(artifactsPath + '/custom.txt', 'custom evidence');
  ` });
  passes(prepare);
  assert.ok(prepare.artifacts.includes('custom.txt'));
  const updated = await f.request({ op: 'exec', script: `
    await mock('**/poll', {json: {value: 'second'}});
    await expect(page.locator('#data')).toHaveText('second');
    await check('state survives fixture replacement', async () => {
      assert.equal(typeof scriptLocal, 'undefined');
      assert.deepEqual(await page.evaluate(() => ({identity:window.identity === window.savedIdentity, filter:document.querySelector('#filter').value, focus:document.activeElement.id, start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd,scroll:scrollY,open:document.querySelector('#panel').open})), {identity:true, filter:'custom filter', focus:'filter', start:2,end:6,scroll:700,open:false});
    });
  ` });
  passes(updated);
  assert.equal(updated.summary.fixtureRevision, 3);
  assert.match(updated.summary.scriptDigest, /^[a-f0-9]{64}$/);
  const dom = await f.request({ op: 'inspect', kind: 'dom', selector: '#data' });
  passes(dom);
  assert.match(dom.summary.inspection.preview, /second/);
  const aria = await f.request({ op: 'inspect', kind: 'accessibility' });
  passes(aria);
  assert.match(aria.summary.inspection.preview, /custom filter/);
  const scoped = await f.request({ op: 'inspect', kind: 'screenshot', selector: '#data' });
  passes(scoped);
  const png = await f.file(scoped.observation, 'screenshot.png');
  assert.ok(png.readUInt32BE(20) < 600, 'selector screenshot is element-sized');

  await fs.writeFile(path.join(f.workspace, 'index.html'), '<!doctype html><title>Synced</title><h1>New source</h1>');
  await fs.writeFile(path.join(f.workspace, 'fixture.txt'), 'new fixture');
  await fs.unlink(path.join(f.workspace, 'deleted.txt'));
  const synced = await f.request({ op: 'sync', files: await packageSource(f.workspace), fingerprint: 'source-v2' });
  passes(synced);
  assert.equal(synced.summary.fingerprint, 'source-v2');
  assert.equal(synced.summary.loadedFingerprint, 'source-v1');
  assert.ok(synced.summary.warnings.some(w => w.code === 'stale-document'));
  const historyOnly = await f.request({ op: 'exec', script: `await page.evaluate(() => history.replaceState({}, '', '#same-document'));` });
  passes(historyOnly);
  assert.equal(historyOnly.summary.loadedFingerprint, 'source-v1', 'history changes are not source reloads');
  const beforeReload = await f.request({ op: 'exec', script: `
    await expect(page).toHaveTitle('Session fixture');
    assert.equal(await page.locator('#filter').inputValue(), 'custom filter');
    assert.equal(await page.evaluate(() => window.identity === window.savedIdentity), true);
    assert.equal(await page.evaluate(() => fetch('/deleted.txt').then(r => r.status)), 404);
    assert.equal(await page.evaluate(() => fetch('/frozen').then(r => r.text())), 'original fixture');
    await mock('**/frozen', {file: 'fixture.txt'});
    assert.equal(await page.evaluate(() => fetch('/frozen').then(r => r.text())), 'new fixture');
    await page.reload(); await expect(page).toHaveTitle('Synced');
  ` });
  passes(beforeReload);
  assert.equal(beforeReload.summary.loadedFingerprint, 'source-v2');
  const stopped = await f.request({ op: 'stop' });
  passes(stopped);
  assert.equal(stopped.summary.state, 'stopped');
  assert.deepEqual(await f.file(first.observation, 'screenshot.png'), firstBytes);
  assert.deepEqual(await f.file(first.observation, 'results.json'), firstJSON);
  assert.equal((await f.request({ op: 'status' })).summary.state, 'stopped');
  await assert.rejects(f.request({ op: 'exec', script: '' }), /Session is stopped/);
});

test('failed assertions preserve session; diagnostics have cursors, truncation and health warnings', async t => {
  const f = await fixture(t);
  await navigate(f);
  const failed = await f.request({ op: 'exec', script: `
    await check('intentional failure', async () => assert.equal(1, 2));
    await check('continues', async () => assert.equal(2, 2));
    console.error('script diagnostic');
    await page.evaluate(() => { console.error('page diagnostic'); setTimeout(() => { throw new Error('page exploded'); }, 0); });
    await context.route('**/broken', route => route.abort());
    await page.evaluate(() => fetch('/broken').catch(() => {}));
    await page.waitForTimeout(70);
  ` });
  assert.equal(failed.summary.ok, false);
  assert.equal(failed.summary.state, 'running');
  assert.equal(failed.summary.counts.passed, 1);
  for (const code of ['page-errors', 'console-errors', 'network-failures']) assert.ok(failed.summary.warnings.some(w => w.code === code));
  const logs = await f.request({ op: 'inspect', kind: 'console', limit: 1 });
  assert.equal(logs.summary.inspection.hasMore, true);
  const next = await f.request({ op: 'inspect', kind: 'console', since: logs.summary.inspection.nextCursor });
  const nextLog = JSON.parse(await f.file(next.observation, 'inspect-console.json'));
  assert.ok(nextLog.events.length > 0);
  assert.ok(nextLog.events.every(event => event.cursor > logs.summary.inspection.nextCursor));
  const empty = await f.request({ op: 'inspect', kind: 'console', since: next.summary.inspection.nextCursor });
  assert.equal(JSON.parse(await f.file(empty.observation, 'inspect-console.json')).events.length, 0);
  const errors = await f.request({ op: 'inspect', kind: 'pageerrors' });
  assert.match(errors.summary.inspection.preview, /page exploded/);
  const flood = await f.request({ op: 'exec', script: `for (let i = 0; i < 2010; i++) console.log('event', i);` });
  passes(flood);
  assert.ok(flood.summary.warnings.some(w => w.code === 'diagnostics-truncated'));
  const truncated = await f.request({ op: 'inspect', kind: 'console', since: 0, limit: 10 });
  assert.ok(truncated.summary.inspection.dropped >= 10);
  assert.equal(truncated.summary.inspection.truncated, true);
});

test('page errors between commands are retained in the next observation', async t => {
  const f = await fixture(t);
  await navigate(f);
  passes(await f.request({ op: 'exec', script: `await page.evaluate(() => setTimeout(() => { throw new Error('between commands'); }, 500));` }));
  await new Promise(resolve => setTimeout(resolve, 700));
  const result = await f.request({ op: 'inspect', kind: 'pageerrors' });
  passes(result);
  assert.ok(result.summary.warnings.some(w => w.code === 'page-errors'));
  assert.match((await f.file(result.observation, 'pageerrors.json')).toString(), /between commands/);
});

test('persistent mocks preserve precedence, validate replacements and snapshot payloads', async t => {
  const f = await fixture(t);
  await navigate(f);
  passes(await f.request({ op: 'exec', script: `
    await mock('**/api/**', {body:'broad'});
    const body = Buffer.from('specific'), headers = {'x-original':'yes'};
    await mock('**/api/value', {body, headers});
    body.fill('x'); headers['x-original'] = 'no';
    await assert.rejects(mock('**/api/value', {body:'bad', status:600}));
    await assert.rejects(mock('**/api/value', {json:undefined}));
    await assert.rejects(mock('**/api/value', {file:'missing'}));
  ` }));
  passes(await f.request({ op: 'exec', script: `
    const get = () => page.evaluate(async () => { const r = await fetch('/api/value'); return {body:await r.text(), header:r.headers.get('x-original')}; });
    assert.deepEqual(await get(), {body:'specific',header:'yes'});
    await mock('**/api/**', {body:'replacement'});
    assert.equal((await get()).body, 'replacement');
    await mock('**/api/**', null);
    assert.equal((await get()).body, 'specific');
    await mock('**/api/value', null);
    assert.equal(await page.evaluate(() => fetch('/api/value').then(r => r.status)), 404);
  ` }));
});

test('requests are serialized and reused observation IDs cannot mutate earlier evidence', async t => {
  const f = await fixture(t);
  await navigate(f);
  const first = f.request({ op: 'exec', id: 'serial-first', script: `await page.waitForTimeout(200); await page.evaluate(() => window.serial = 'first');` });
  const second = f.request({ op: 'exec', id: 'serial-second', script: `assert.equal(await page.evaluate(() => window.serial), 'first'); await page.evaluate(() => window.serial = 'second');` });
  const [a, b] = await Promise.all([first, second]);
  passes(a); passes(b);
  const original = await f.file(a.observation, 'results.json');
  await assert.rejects(f.request({ op: 'exec', id: 'serial-first', script: 'throw new Error("must not execute")' }), /already used/);
  assert.deepEqual(await f.file(a.observation, 'results.json'), original);
  passes(await f.request({ op: 'exec', script: `assert.equal(await page.evaluate(() => window.serial), 'second');` }));
});

for (const [name, script] of [
  ['async', `await new Promise(resolve => setTimeout(resolve, 1200)); await require('node:fs/promises').writeFile(artifactsPath + '/late.txt', 'unsafe late write');`],
  ['sync', 'while (true) {}'],
]) test(`${name} timeout kills the worker before the queued exec can run`, async t => {
  const f = await fixture(t);
  await navigate(f);
  const began = Date.now();
  const runaway = f.request({ op: 'exec', id: 'runaway', timeoutMs: 200, script });
  const following = f.request({ op: 'exec', id: 'after-timeout', script: `throw new Error('must not run')` }).then(() => { throw new Error('queued command unexpectedly ran'); }, error => error);
  const result = await runaway;
  assert.equal(result.summary.ok, false);
  assert.equal(result.summary.state, 'failed');
  assert.match(result.summary.checks[0].error, /timed out/);
  assert.ok(result.summary.warnings.some(w => w.code === 'session-invalidated'));
  assert.match((await following).message, /Session is failed/);
  assert.ok(Date.now() - began < 5000);
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.equal((await f.request({ op: 'status' })).summary.state, 'failed');
  assert.deepEqual(await fs.readdir(path.join(f.observations, 'runaway')), ['results.json']);
  await assert.rejects(fs.stat(path.join(f.observations, 'after-timeout')), /ENOENT/);
});

test('controller rejects origins, credentials, restarts, unsafe paths and unsafe sync files', async t => {
  const f = await fixture(t);
  await assert.rejects(f.request({ op: 'status' }, { Authorization: 'Bearer wrong' }), /403/);
  await assert.rejects(f.request({ op: 'status' }, { Origin: 'http:\/\/page.example' }), /403/);
  await assert.rejects(f.request({ op: 'exec', script: '', expectedInstance: 'different-boot' }), /instance changed/);
  await assert.rejects(f.request({ op: 'exec', id: '../escape', script: '' }), /Invalid observation ID/);
  const observation = await navigate(f);
  for (const name of ['../results.json', '/etc/passwd', 'missing', 'x\\y', 'trace.zip/../results.json']) await assert.rejects(f.file(observation.observation, name), /Unknown artifact/);
  // Even an inventoried path must still be a regular file when fetched.
  await fs.unlink(path.join(f.observations, observation.observation, 'screenshot.png'));
  await fs.symlink('/etc/passwd', path.join(f.observations, observation.observation, 'screenshot.png'));
  await assert.rejects(f.file(observation.observation, 'screenshot.png'), /symlinks/);
  const badSync = await f.request({ op: 'sync', fingerprint: 'bad', files: [{ path: '../escape', data: '' }] });
  assert.equal(badSync.summary.ok, false);
  assert.equal(badSync.summary.fingerprint, 'source-v1');
  passes(await f.request({ op: 'exec', script: `await expect(page).toHaveTitle('Session fixture');` }));
  await fs.symlink('index.html', path.join(f.workspace, 'link'));
  await assert.rejects(packageSource(f.workspace), /symlinks/);
});

test('URL sessions reject sync and never claim workspace navigation provenance', async t => {
  const f = await fixture(t, { root: false, url: 'http://127.0.0.1:9/' });
  const result = await f.request({ op: 'exec', script: `await page.setContent('<h1>Remote-like content</h1>');` });
  passes(result);
  assert.equal(result.summary.loadedFingerprint, null);
  await assert.rejects(f.request({ op: 'sync', fingerprint: 'no', files: [] }), /Cannot sync a URL session/);
});

test('idle expiry closes the browser while retained observations remain fetchable', async t => {
  const f = await fixture(t, { idleTimeoutMs: 600 });
  const first = await navigate(f);
  const bytes = await f.file(first.observation, 'screenshot.png');
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal((await f.request({ op: 'status' })).summary.state, 'stopped');
  assert.deepEqual(await f.file(first.observation, 'screenshot.png'), bytes);
});

test('client materializes immutable evidence and state, detects restarts, and prints only JSON', async t => {
  const f = await fixture(t);
  const output = path.join(f.root, 'client'); await fs.mkdir(output);
  const options = { endpoint: f.service.endpoint, token: f.token, instance: f.service.instanceID, artifacts: path.join(output, 'artifacts'), summaryPath: path.join(output, 'summary.json'), statePath: path.join(output, 'state.json') };
  const result = await client({ op: 'exec', id: 'client-observation', script: `console.log('captured, not stdout'); await page.goto(baseURL);` }, options);
  passes(result);
  assert.deepEqual(JSON.parse(await fs.readFile(options.summaryPath, 'utf8')), result);
  assert.equal(JSON.parse(await fs.readFile(options.statePath, 'utf8')).instanceID, f.service.instanceID);
  assert.deepEqual((await fs.readdir(options.artifacts)).sort(), result.artifacts);
  await assert.rejects(client({ op: 'status' }, { ...options, instance: 'restarted' }), /instance changed/);
  // The CLI's fixed paths are safe in the disposable prepared test container.
  await fs.rm('/artifacts', { recursive: true, force: true });
  const command = path.join(output, 'command.json'); await fs.writeFile(command, JSON.stringify({ op: 'status' }));
  const { stdout } = await exec(process.execPath, [path.resolve(__dirname, '../client.cjs'), command], { env: { ...process.env, BROWSER_ENDPOINT: f.service.endpoint, BROWSER_TOKEN: f.token, BROWSER_INSTANCE: f.service.instanceID } });
  assert.equal(stdout.trim().split('\n').length, 1);
  assert.equal(JSON.parse(stdout).state, 'running');
  const bytes = await fs.readFile(path.join(options.artifacts, 'screenshot.png'));
  await f.request({ op: 'stop' });
  assert.deepEqual(await fs.readFile(path.join(options.artifacts, 'screenshot.png')), bytes);
});

test('event buffers report dropped and remaining ranges without duplicate cursors', () => {
  const events = new Events();
  for (let i = 0; i < 2010; i++) events.add({ text: String(i) });
  const first = events.read(0, 2);
  assert.equal(first.dropped, 10); assert.equal(first.nextCursor, 12); assert.equal(first.hasMore, true);
  const rest = events.read(first.nextCursor);
  assert.equal(rest.events.length, 1998); assert.equal(rest.dropped, 0); assert.equal(rest.hasMore, false);
  assert.equal(events.read(rest.nextCursor).events.length, 0);
});
