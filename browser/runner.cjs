'use strict';

// One isolated run per invocation. This is not a JavaScript security sandbox:
// the container, not AsyncFunction, is the boundary for user code.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

async function workspaceFile(root, name) {
  const resolved = path.resolve(root, name);
  if (!inside(root, resolved)) throw new Error('Path escapes workspace');
  const real = await fs.realpath(resolved);
  if (!inside(root, real)) throw new Error('Symlink escapes workspace');
  return real;
}

async function serve(root) {
  root = await fs.realpath(root);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm' };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    try {
      const pathname = decodeURIComponent(req.url.split(/[?#]/, 1)[0]);
      if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').includes('..')) throw new Error('Unsafe path');
      let file = await workspaceFile(root, `.${pathname}`);
      if ((await fs.stat(file)).isDirectory()) file = await workspaceFile(root, path.join(file, 'index.html'));
      if (!(await fs.stat(file)).isFile()) throw new Error('Not a file');
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 403).end('Not found');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { baseURL: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}

function validate(input) {
  if (!input || typeof input !== 'object') throw new Error('Input must be an object');
  if (typeof input.script !== 'string') throw new Error('script must be a string');
  if (!['chromium', 'firefox', 'webkit'].includes(input.browser)) throw new Error('Invalid browser');
  for (const key of ['width', 'height']) if (!Number.isInteger(input[key]) || input[key] < 1 || input[key] > 8192) throw new Error(`Invalid ${key}`);
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 600000) throw new Error('timeoutMs must be between 1 and 600000');
  if (typeof input.root !== 'boolean') throw new Error('root must be a boolean');
  if (!input.root && !['http:', 'https:'].includes(new URL(input.url).protocol)) throw new Error('url must use HTTP or HTTPS');
}

const errorText = error => String(error && (error.stack || error.message) || error);
const clip = (value, size = 1000) => String(value).slice(0, size);
function summarize(result) {
  return {
    ok: result.ok, counts: result.counts, fingerprint: clip(result.fingerprint, 256),
    browser: result.browser, playwrightVersion: result.playwrightVersion,
    durationMs: result.durationMs,
    checks: result.checks.slice(0, 20).map(({ name, status, error }) => ({ name: clip(name, 120), status, ...(error ? { error: clip(error, 500) } : {}) })),
    omittedChecks: Math.max(0, result.checks.length - 20),
    consoleMessages: result.console.length, pageErrors: result.pageErrors.length,
    networkFailures: result.network.filter(event => event.type === 'failed').length,
    artifacts: result.artifacts.slice(0, 30), omittedArtifacts: Math.max(0, result.artifacts.length - 30),
    ...(result.infrastructureError ? { infrastructureError: clip(result.infrastructureError) } : {}),
  };
}

async function run(input, { workspace = '/workspace', artifacts = '/artifacts' } = {}) {
  validate(input);
  const { chromium, firefox, webkit, expect } = require('@playwright/test');
  const started = performance.now();
  workspace = await fs.realpath(workspace);
  await fs.mkdir(artifacts, { recursive: true });
  artifacts = await fs.realpath(artifacts);
  if (inside(workspace, artifacts)) throw new Error('Artifacts must be outside workspace');
  const result = {
    ok: false, counts: { total: 0, passed: 0, failed: 0 }, checks: [],
    fingerprint: input.fingerprint || '', browser: { name: input.browser },
    playwrightVersion: require('@playwright/test/package.json').version,
    console: [], pageErrors: [], network: [], artifacts: [],
  };
  let server, browser, context, page, timer, timedOut = false;
  const pending = new Set();
  const updateCounts = () => {
    result.counts = { total: result.checks.length, passed: result.checks.filter(c => c.status === 'passed').length, failed: result.checks.filter(c => c.status === 'failed').length };
    result.ok = result.counts.failed === 0 && !result.infrastructureError;
    result.durationMs = Math.round(performance.now() - started);
  };
  const persist = async () => {
    updateCounts();
    await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify(result, null, 2));
  };
  const failure = (name, error) => result.checks.push({ name, status: 'failed', error: errorText(error), durationMs: Math.round(performance.now() - started) });
  // A rejection shared by the script and checks makes a hanging check report a
  // failure as well as stopping the run. The CLI adds an out-of-process watchdog
  // for synchronous infinite loops which cannot yield to this timer.
  let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  deadline.catch(() => {});
  try {
    if (input.root) server = await serve(workspace);
    const baseURL = server ? server.baseURL : input.url;
    result.baseURL = baseURL;
    browser = await ({ chromium, firefox, webkit }[input.browser]).launch({ headless: true });
    result.browser.version = browser.version();
    context = await browser.newContext({ viewport: { width: input.width, height: input.height }, baseURL, serviceWorkers: 'block' });
    context.setDefaultTimeout(input.timeoutMs);
    context.setDefaultNavigationTimeout(input.timeoutMs);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const observe = p => {
      p.on('console', message => result.console.push({ type: message.type(), text: message.text(), location: message.location() }));
      p.on('pageerror', error => result.pageErrors.push(errorText(error)));
    };
    context.on('page', observe);
    context.on('request', request => result.network.push({ type: 'request', method: request.method(), url: request.url() }));
    context.on('response', response => result.network.push({ type: 'response', status: response.status(), url: response.url() }));
    context.on('requestfailed', request => result.network.push({ type: 'failed', url: request.url(), error: request.failure()?.errorText }));
    page = await context.newPage(); // Deliberately leave about:blank; mocks can precede navigation.
    const screenshot = async (name = 'screenshot') => {
      if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(name)) throw new Error('Unsafe screenshot name');
      const filename = name.endsWith('.png') ? name : `${name}.png`;
      await page.screenshot({ path: path.join(artifacts, filename), fullPage: true, timeout: Math.min(5000, input.timeoutMs) });
      if (!result.artifacts.includes(filename)) result.artifacts.push(filename);
      return filename;
    };
    const routes = new Map();
    // Await mock(pattern, response) before navigation/fetch. Patterns use
    // Playwright URL globs. Replacing a pattern moves it to highest precedence;
    // null removes it. JSON is encoded, never interpolated into HTML.
    const mock = async (pattern, response) => {
      if (typeof pattern !== 'string' || !pattern) throw new Error('mock pattern must be a nonempty string');
      let fulfillment;
      if (response !== null) {
        if (!response || typeof response !== 'object') throw new Error('mock response must be an object or null');
        const kinds = ['json', 'body', 'file'].filter(key => Object.hasOwn(response, key));
        if (kinds.length !== 1) throw new Error('mock requires exactly one of json, body, file');
        fulfillment = { status: response.status ?? 200, headers: response.headers };
        if (kinds[0] === 'file') fulfillment.body = await fs.readFile(await workspaceFile(workspace, response.file));
        else if (kinds[0] === 'json') { fulfillment.body = JSON.stringify(response.json); fulfillment.contentType = 'application/json'; if (fulfillment.body === undefined) throw new Error('Invalid JSON fixture'); }
        else { if (typeof response.body !== 'string' && !Buffer.isBuffer(response.body)) throw new Error('mock body must be a string or Buffer'); fulfillment.body = response.body; }
      }
      if (routes.has(pattern)) { await context.unroute(pattern, routes.get(pattern)); routes.delete(pattern); }
      if (response === null) return;
      const handler = async route => {
        try { await route.fulfill(fulfillment); }
        catch (error) { if (!timedOut) failure('mock', error); await route.abort().catch(() => {}); }
      };
      routes.set(pattern, handler);
      await context.route(pattern, handler);
    };
    // check catches assertions and continues the script; await it for ordering.
    const check = (name, fn) => {
      const task = (async () => {
        const start = performance.now();
        const entry = { name: String(name), status: 'passed' };
        try { if (typeof fn !== 'function') throw new Error('check requires a function'); await Promise.race([Promise.resolve().then(fn), deadline]); }
        catch (error) { entry.status = 'failed'; entry.error = errorText(error); }
        entry.durationMs = Math.round(performance.now() - start);
        result.checks.push(entry);
      })();
      pending.add(task);
      task.finally(() => pending.delete(task));
      return task;
    };
    await persist();
    timer = setTimeout(() => { timedOut = true; rejectDeadline(new Error(`Run timed out after ${input.timeoutMs}ms`)); }, input.timeoutMs);
    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const execute = new AsyncFunction('page', 'context', 'browser', 'baseURL', 'expect', 'assert', 'check', 'mock', 'screenshot', input.script);
      await Promise.race([execute(page, context, browser, baseURL, expect, assert, check, mock, screenshot), deadline]);
      await Promise.race([Promise.all([...pending]), deadline]);
    } catch (error) { failure('script', error); }
    await Promise.all([...pending]);
    clearTimeout(timer);
    // Capture before closing even on assertion or script failures. Cleanup has
    // its own bounded grace, enforced by the supervising CLI process.
    try { await screenshot(); } catch (error) { result.captureErrors = [errorText(error)]; }
  } catch (error) { result.infrastructureError = errorText(error); }
  finally {
    clearTimeout(timer);
    if (context) {
      try { await context.tracing.stop({ path: path.join(artifacts, 'trace.zip') }); result.artifacts.push('trace.zip'); }
      catch (error) { (result.captureErrors ||= []).push(errorText(error)); }
    }
    if (browser) await browser.close().catch(error => { (result.captureErrors ||= []).push(errorText(error)); });
    if (server) await server.close();
    for (const [filename, data] of [['console.json', result.console], ['network.json', result.network], ['pageerrors.json', result.pageErrors]]) {
      await fs.writeFile(path.join(artifacts, filename), JSON.stringify(data, null, 2));
      result.artifacts.push(filename);
    }
    result.artifacts.push('results.json');
    await persist();
  }
  return summarize(result);
}

async function cli() {
  const worker = process.argv[2] === '--worker';
  const [inputPath = '/input.json', workspace = '/workspace', artifacts = '/artifacts'] = process.argv.slice(worker ? 3 : 2);
  const input = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  validate(input);
  if (worker) {
    const summary = await run(input, { workspace, artifacts });
    process.send({ summary }, () => process.exit(summary.infrastructureError ? 1 : 0));
    return;
  }
  const child = fork(__filename, ['--worker', inputPath, workspace, artifacts], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  let summary;
  child.on('message', message => { if (message.summary) summary = message.summary; });
  const watchdog = setTimeout(() => child.kill('SIGKILL'), input.timeoutMs + 15000);
  const [code, signal] = await new Promise(resolve => child.once('exit', (...args) => resolve(args)));
  clearTimeout(watchdog);
  if (!summary && signal === 'SIGKILL') {
    // A synchronous runaway cannot execute its own finally block. Preserve any
    // evidence already written and make the timeout explicit, not a false pass.
    let partial;
    try { partial = JSON.parse(await fs.readFile(path.join(artifacts, 'results.json'), 'utf8')); }
    catch { partial = { checks: [], console: [], pageErrors: [], network: [], artifacts: [], browser: { name: input.browser }, fingerprint: input.fingerprint || '' }; }
    partial.checks.push({ name: 'script', status: 'failed', error: 'Run exceeded timeout and cleanup grace; worker terminated' });
    partial.counts = { total: partial.checks.length, passed: partial.checks.filter(c => c.status === 'passed').length, failed: partial.checks.filter(c => c.status === 'failed').length };
    partial.ok = false;
    partial.durationMs = input.timeoutMs + 15000;
    partial.captureErrors = ['Forced termination: final screenshot and trace may be unavailable'];
    await fs.mkdir(artifacts, { recursive: true });
    await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify(partial, null, 2));
    summary = summarize(partial);
  }
  if (!summary) throw new Error(`Browser worker exited without results (code ${code}, signal ${signal})`);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exitCode = summary.infrastructureError ? 1 : 0;
}

module.exports = { run, serve, workspaceFile };
if (require.main === module) cli().catch(error => { process.stderr.write(`${errorText(error)}\n`); process.exitCode = 1; });
