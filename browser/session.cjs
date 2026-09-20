'use strict';

// The controller never executes user JavaScript. A detached worker owns the
// browser, so even a synchronous infinite loop can be killed before another
// command is accepted. This is lifecycle isolation, not an untrusted-code sandbox.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { Console } = require('node:console');
const { Writable } = require('node:stream');
const { serve, workspaceFile } = require('./runner.cjs');

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const MAX_OBSERVATIONS = 200;
const MAX_SESSION_BYTES = 512 * 1024 * 1024;
const EVENT_LIMIT = 2000;
const errorText = error => String(error?.stack || error?.message || error);
const clip = (value, n = 8000) => String(value).slice(0, n);
const validID = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(id);
const validFingerprint = value => typeof value === 'string' && /^[A-Za-z0-9:._-]{0,256}$/.test(value);
const safeRelative = name => typeof name === 'string' && name.length > 0 && name.length <= 1024 && !name.includes('\\') && !name.includes('\0') && !path.posix.isAbsolute(name) && name.split('/').every(part => part !== '' && part !== '.' && part !== '..');
const digest = script => crypto.createHash('sha256').update(script).digest('hex');

async function regularFile(root, name) {
  if (!safeRelative(name)) throw new Error('Invalid artifact path');
  let current = root;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Artifact symlinks are not allowed');
  }
  if (!(await fs.stat(current)).isFile()) throw new Error('Artifact is not a regular file');
  return current;
}

async function inventory(root, prefix = '') {
  const out = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...await inventory(root, name));
    else if (entry.isFile()) out.push(name);
  }
  return out.sort();
}

function validateConfig(config) {
  if (!validID(config.session)) throw new Error('Invalid session ID');
  if (typeof config.token !== 'string' || config.token.length < 16) throw new Error('A control token of at least 16 characters is required');
  if (typeof config.root !== 'boolean') throw new Error('root must be a boolean');
  if (config.fingerprint !== undefined && !validFingerprint(config.fingerprint)) throw new Error('Invalid source fingerprint');
  if (!config.root && !['http:', 'https:'].includes(new URL(config.url).protocol)) throw new Error('url must use HTTP or HTTPS');
  if (!['chromium', 'firefox', 'webkit'].includes(config.browser)) throw new Error('Invalid browser');
  for (const key of ['width', 'height']) if (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > 8192) throw new Error(`Invalid ${key}`);
  if (config.idleTimeoutMs !== undefined && (!Number.isInteger(config.idleTimeoutMs) || config.idleTimeoutMs < 1 || config.idleTimeoutMs > 3600000)) throw new Error('idleTimeoutMs must be between 1 and 3600000');
}

function validateCommand(command) {
  if (!command || !['exec', 'inspect', 'sync', 'stop', 'status'].includes(command.op)) throw new Error('Invalid command op');
  if (command.op === 'status') return;
  if (!validID(command.id)) throw new Error('Invalid observation ID');
  if (command.timeoutMs !== undefined && (!Number.isInteger(command.timeoutMs) || command.timeoutMs < 1 || command.timeoutMs > 600000)) throw new Error('timeoutMs must be between 1 and 600000');
  if (command.op === 'exec' && (typeof command.script !== 'string' || Buffer.byteLength(command.script) > 1024 * 1024)) throw new Error('script must be a string of at most 1 MiB');
  if (command.op === 'inspect') {
    if (!['screenshot', 'accessibility', 'dom', 'console', 'network', 'pageerrors'].includes(command.kind)) throw new Error('Invalid inspection kind');
    if (command.selector != null && typeof command.selector !== 'string') throw new Error('selector must be a string');
    if (command.since !== undefined && (!Number.isInteger(command.since) || command.since < 0)) throw new Error('since must be a nonnegative cursor');
    if (command.limit !== undefined && (!Number.isInteger(command.limit) || command.limit < 1 || command.limit > EVENT_LIMIT)) throw new Error(`limit must be between 1 and ${EVENT_LIMIT}`);
  }
}

// An atomic pointer switch publishes complete source generations. Old
// generations remain until stop so requests already resolving them can finish.
async function materialize(files, dir) {
  if (!Array.isArray(files) || files.length > 10000) throw new Error('sync requires at most 10000 files');
  const seen = new Set();
  let size = 0;
  const decoded = files.map(file => {
    if (!safeRelative(file.path) || seen.has(file.path) || typeof file.data !== 'string' || file.data.length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4) throw new Error('Invalid sync file');
    seen.add(file.path);
    const bytes = Buffer.from(file.data, 'base64');
    if (bytes.toString('base64') !== file.data) throw new Error('Invalid sync file encoding');
    size += bytes.length;
    if (size > MAX_SOURCE_BYTES) throw new Error('Source exceeds 64 MiB');
    return [file.path, bytes];
  });
  await fs.mkdir(dir);
  try {
    for (const [name, bytes] of decoded) {
      await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
      await fs.writeFile(path.join(dir, name), bytes, { flag: 'wx' });
    }
  } catch (error) { await fs.rm(dir, { recursive: true, force: true }); throw error; }
  return size;
}

class Events {
  constructor() { this.next = 0; this.values = []; }
  add(event) {
    this.values.push({ ...event, cursor: ++this.next, time: new Date().toISOString() });
    if (this.values.length > EVENT_LIMIT) this.values.shift();
  }
  read(since = 0, limit = EVENT_LIMIT) {
    const available = this.values.filter(value => value.cursor > since);
    const events = available.slice(0, limit);
    const first = this.values[0]?.cursor || this.next + 1;
    return { events, nextCursor: events.at(-1)?.cursor ?? Math.max(since, this.next), dropped: Math.max(0, first - since - 1), truncated: since < first - 1 || available.length > limit, hasMore: available.length > limit };
  }
}

async function worker(config, workspace, working) {
  const { chromium, firefox, webkit, expect } = require('@playwright/test');
  let currentRoot = await fs.realpath(workspace);
  await fs.mkdir(path.join(working, 'observations'));
  await fs.mkdir(path.join(working, 'sources'));
  const sourceFingerprints = new Map([[currentRoot, config.fingerprint || '']]);
  const staticServer = config.root ? await serve(currentRoot, { currentRoot: () => currentRoot, responseHeaders: root => ({ 'X-Browser-Source-Fingerprint': sourceFingerprints.get(root) }) }) : null;
  const baseURL = staticServer?.baseURL || config.url;
  const browser = await ({ chromium, firefox, webkit }[config.browser]).launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: config.width, height: config.height }, baseURL, serviceWorkers: 'block' });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const events = { console: new Events(), network: new Events(), pageerrors: new Events() };
  let fingerprint = config.fingerprint || '', loadedFingerprint = null, fixtureRevision = 0;
  let sourceBytes = 0;
  const sourceDirs = [];
  const routes = new Map();
  const observedCursors = { console: 0, network: 0, pageerrors: 0 };
  const summary = () => ({ session: config.session, state: 'running', browser: { name: config.browser, version: browser.version() }, playwrightVersion: require('@playwright/test/package.json').version, baseURL, fingerprint, loadedFingerprint, fixtureRevision });
  const notify = () => process.send?.({ state: summary() });
  context.on('page', p => {
    p.on('console', message => events.console.add({ source: 'page', type: message.type(), text: clip(message.text(), 16000), location: message.location() }));
    p.on('pageerror', error => events.pageerrors.add({ text: clip(errorText(error), 16000) }));
  });
  context.on('request', request => events.network.add({ type: 'request', method: request.method(), url: clip(request.url(), 4000) }));
  context.on('response', response => events.network.add({ type: 'response', status: response.status(), url: clip(response.url(), 4000) }));
  context.on('requestfailed', request => events.network.add({ type: 'failed', url: clip(request.url(), 4000), error: request.failure()?.errorText }));
  const page = await context.newPage();
  let stopping = false;
  const closed = resource => {
    if (!stopping) process.send?.({ fatal: `${resource} closed; session invalidated` });
  };
  browser.on('disconnected', () => closed('Browser'));
  context.on('close', () => closed('Browser context'));
  page.on('close', () => closed('Session page'));
  // Provenance comes from the served main-document response, not from the
  // current source pointer at framenavigated: hash/history changes are not reloads.
  page.on('response', response => {
    if (!response.request().isNavigationRequest() || response.frame() !== page.mainFrame()) return;
    loadedFingerprint = config.root && response.url().startsWith(`${baseURL}/`) ? response.headers()['x-browser-source-fingerprint'] ?? null : null;
    notify();
  });
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    if (!config.root || !frame.url().startsWith(`${baseURL}/`)) loadedFingerprint = null;
    notify();
  });

  const mock = async (pattern, response) => {
    if (typeof pattern !== 'string' || !pattern) throw new Error('mock pattern must be a nonempty string');
    let fulfillment;
    if (response !== null) {
      if (!response || typeof response !== 'object') throw new Error('mock response must be an object or null');
      const kinds = ['json', 'body', 'file'].filter(key => Object.hasOwn(response, key));
      if (kinds.length !== 1) throw new Error('mock requires exactly one of json, body, file');
      const status = response.status ?? 200;
      if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error('mock status must be an integer between 100 and 599');
      if (response.headers !== undefined && (!response.headers || typeof response.headers !== 'object' || Array.isArray(response.headers) || Object.values(response.headers).some(value => typeof value !== 'string'))) throw new Error('mock headers must be an object with string values');
      fulfillment = { status, headers: response.headers ? { ...response.headers } : undefined };
      if (kinds[0] === 'file') fulfillment.body = await fs.readFile(await workspaceFile(currentRoot, response.file));
      else if (kinds[0] === 'json') { fulfillment.body = JSON.stringify(response.json); fulfillment.contentType = 'application/json'; if (fulfillment.body === undefined) throw new Error('Invalid JSON fixture'); }
      else { if (typeof response.body !== 'string' && !Buffer.isBuffer(response.body)) throw new Error('mock body must be a string or Buffer'); fulfillment.body = Buffer.isBuffer(response.body) ? Buffer.from(response.body) : response.body; }
    }
    if (routes.has(pattern)) { await context.unroute(pattern, routes.get(pattern)); routes.delete(pattern); }
    if (response !== null) {
      const handler = async route => {
        try { await route.fulfill(fulfillment); }
        catch (error) { events.pageerrors.add({ source: 'mock', text: clip(errorText(error)) }); await route.abort().catch(() => {}); }
      };
      routes.set(pattern, handler);
      await context.route(pattern, handler);
    }
    fixtureRevision++;
    notify();
  };

  async function command(cmd) {
    const start = Date.now();
    const artifactsPath = path.join(working, 'observations', cmd.id);
    await fs.mkdir(artifactsPath);
    // Include events arriving while no command was running, not only events
    // emitted by this command's script. Inspection cursors remain independent.
    const cursors = { ...observedCursors };
    const checks = [], warnings = [];
    let inspection;
    const timeout = cmd.timeoutMs || 30000;
    context.setDefaultTimeout(timeout);
    context.setDefaultNavigationTimeout(timeout);
    const screenshot = async (name = 'screenshot') => {
      if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(name)) throw new Error('Unsafe screenshot name');
      const filename = name.endsWith('.png') ? name : `${name}.png`;
      const capture = cmd.op === 'inspect' && cmd.kind === 'screenshot' && cmd.selector ? page.locator(cmd.selector) : page;
      await capture.screenshot({ path: path.join(artifactsPath, filename), ...(capture === page ? { fullPage: true } : {}), timeout: Math.min(timeout, 5000) });
      return filename;
    };
    await context.tracing.startChunk({ title: `${cmd.op} ${cmd.id}` });
    try {
      if (cmd.op === 'exec') {
        const pending = new Set();
        const check = (name, fn) => {
          const task = (async () => {
            const began = Date.now();
            const entry = { name: String(name), status: 'passed' };
            try { if (typeof fn !== 'function') throw new Error('check requires a function'); await fn(); }
            catch (error) { entry.status = 'failed'; entry.error = errorText(error); }
            entry.durationMs = Date.now() - began;
            checks.push(entry);
          })();
          pending.add(task); task.finally(() => pending.delete(task)); return task;
        };
        const output = type => new Writable({ write(chunk, encoding, callback) { events.console.add({ source: 'script', type, text: clip(chunk.toString().replace(/\n$/, ''), 16000) }); callback(); } });
        const scriptConsole = new Console({ stdout: output('log'), stderr: output('error'), colorMode: false });
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        try {
          const execute = new AsyncFunction('page', 'context', 'browser', 'baseURL', 'expect', 'assert', 'check', 'mock', 'screenshot', 'require', 'console', 'artifactsPath', cmd.script);
          await execute(page, context, browser, baseURL, expect, assert, check, mock, screenshot, require, scriptConsole, artifactsPath);
        } catch (error) { checks.push({ name: 'script', status: 'failed', error: errorText(error) }); }
        await Promise.all([...pending]);
      } else if (cmd.op === 'inspect') {
        let text;
        if (events[cmd.kind]) {
          inspection = { kind: cmd.kind, ...events[cmd.kind].read(cmd.since, cmd.limit) };
          text = JSON.stringify(inspection, null, 2);
        } else if (cmd.kind === 'dom') text = cmd.selector ? await page.locator(cmd.selector).evaluate(node => node.outerHTML) : await page.content();
        else if (cmd.kind === 'accessibility') text = await page.locator(cmd.selector || 'body').ariaSnapshot();
        if (text !== undefined) {
          const name = `inspect-${cmd.kind}.${events[cmd.kind] ? 'json' : cmd.kind === 'dom' ? 'html' : 'txt'}`;
          await fs.writeFile(path.join(artifactsPath, name), text);
          inspection = { ...inspection, kind: cmd.kind, artifact: name, preview: clip(text), previewTruncated: text.length > 8000 };
          delete inspection.events; // Full events live in the artifact, not the tool response.
        }
      } else if (cmd.op === 'sync') {
        if (!config.root) throw new Error('Cannot sync a URL session');
        if (!validFingerprint(cmd.fingerprint)) throw new Error('sync requires a valid fingerprint');
        const generation = path.join(working, 'sources', cmd.id);
        if (sourceBytes >= MAX_SESSION_BYTES) throw new Error('Source generation retention limit reached; start a new session');
        const size = await materialize(cmd.files, generation);
        sourceFingerprints.set(generation, cmd.fingerprint);
        currentRoot = generation;
        sourceDirs.push(generation);
        sourceBytes += size;
        fingerprint = cmd.fingerprint;
        notify();
      }
    } catch (error) {
      // Invalid operations are command errors; unlike assertions they are not passes.
      warnings.push({ code: 'command-error', message: errorText(error) });
    }
    try { await screenshot(); } catch (error) { warnings.push({ code: 'capture-error', message: clip(errorText(error)) }); }
    try { await context.tracing.stopChunk({ path: path.join(artifactsPath, 'trace.zip') }); }
    catch (error) { warnings.push({ code: 'trace-error', message: clip(errorText(error)) }); }
    const diagnosticCursors = {};
    for (const [kind, buffer] of Object.entries(events)) {
      const data = buffer.read(cursors[kind]);
      await fs.writeFile(path.join(artifactsPath, `${kind}.json`), JSON.stringify(data, null, 2));
      diagnosticCursors[kind] = data.nextCursor;
      observedCursors[kind] = data.nextCursor;
      if (data.truncated) warnings.push({ code: 'diagnostics-truncated', message: `${kind} buffer exceeded ${EVENT_LIMIT} events` });
      if (kind === 'pageerrors' && data.events.length) warnings.push({ code: 'page-errors', message: `${data.events.length} page or mock errors` });
      if (kind === 'network' && data.events.some(event => event.type === 'failed')) warnings.push({ code: 'network-failures', message: 'Some browser requests failed' });
      if (kind === 'network' && data.events.some(event => event.type === 'response' && event.status >= 400)) warnings.push({ code: 'http-errors', message: 'Some browser responses returned HTTP 4xx or 5xx' });
      if (kind === 'console' && data.events.some(event => event.type === 'error')) warnings.push({ code: 'console-errors', message: 'Console errors were observed' });
    }
    if (loadedFingerprint !== null && loadedFingerprint !== fingerprint) warnings.push({ code: 'stale-document', message: 'Source changed; the loaded document has not been reloaded' });
    if (loadedFingerprint === null) warnings.push({ code: 'unknown-loaded-source', message: 'Loaded document has no verified workspace fingerprint' });
    if (cmd.op === 'stop') {
      stopping = true;
      await browser.close();
      await staticServer?.close();
      for (const dir of sourceDirs) await fs.rm(dir, { recursive: true, force: true });
    }
    const counts = { total: checks.length, passed: checks.filter(entry => entry.status === 'passed').length, failed: checks.filter(entry => entry.status === 'failed').length };
    return {
      ...summary(), ...(cmd.op === 'stop' ? { state: 'stopped' } : {}), observation: cmd.id, op: cmd.op,
      ok: counts.failed === 0 && !warnings.some(w => w.code === 'command-error'), counts, checks,
      warnings, diagnosticCursors, durationMs: Date.now() - start,
      ...(cmd.script !== undefined ? { scriptDigest: digest(cmd.script) } : {}), ...(inspection ? { inspection } : {}),
    };
  }
  process.on('message', async cmd => {
    try { process.send({ done: cmd.id, result: await command(cmd) }, () => { if (cmd.op === 'stop') process.exit(0); }); }
    catch (error) { process.send({ done: cmd.id, error: errorText(error) }); }
  });
  process.send({ ready: summary() });
}

async function controller(config, { workspace = '/workspace', observations = '/observations', port = 8080, host = '0.0.0.0' } = {}) {
  validateConfig(config);
  await fs.mkdir(observations, { recursive: true });
  const working = await fs.mkdtemp(path.join(path.dirname(observations), '.browser-working-'));
  const instanceID = crypto.randomUUID();
  const child = fork(__filename, ['--worker', JSON.stringify({ ...config, token: undefined }), workspace, working], { detached: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc'], env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^BROWSER_(TOKEN|INSTANCE|ENDPOINT)$/.test(key))) });
  let state = { session: config.session, instanceID, state: 'starting', fingerprint: config.fingerprint || '', loadedFingerprint: null, fixtureRevision: 0 };
  let pending, exited = false, killTask, idle, queue = Promise.resolve(), queued = 0, usedBytes = 0;
  const retained = new Map();
  const ids = new Set();
  let startupResolve, startupReject;
  const startup = new Promise((resolve, reject) => { startupResolve = resolve; startupReject = reject; });
  child.on('message', message => {
    if (message.ready) { state = { ...message.ready, instanceID }; startupResolve(); }
    if (message.state && state.state === 'running') state = { ...state, ...message.state, instanceID };
    if (message.fatal && !['failed', 'stopped'].includes(state.state)) {
      clearTimeout(idle);
      state = { ...state, state: 'failed', failure: String(message.fatal) };
      startupReject(new Error(state.failure));
      pending?.reject(new Error(state.failure)); pending = null;
      void kill().catch(error => { state.failure = errorText(error); });
    }
    if (message.done && pending?.id === message.done) { const waiting = pending; pending = null; message.error ? waiting.reject(new Error(message.error)) : waiting.resolve(message.result); }
  });
  child.on('error', error => { startupReject(error); pending?.reject(error); pending = null; });
  child.on('exit', (code, signal) => {
    clearTimeout(idle);
    exited = true;
    if (!['stopped', 'failed'].includes(state.state)) state = { ...state, state: 'failed', failure: `Browser worker exited (code ${code}, signal ${signal})` };
    startupReject(new Error(state.failure || 'Browser worker exited during startup'));
    pending?.reject(new Error(state.failure || 'Browser worker stopped')); pending = null;
    // A worker crash must not leave its browser descendants alive until idle
    // expiry. The group is killed only once, avoiding PID reuse after retention.
    void kill().catch(error => { state.failure = errorText(error); });
  });
  const kill = () => {
    // Every caller must wait for termination, including when a fatal message
    // and the active command's rejection both try to invalidate the worker.
    if (!killTask) killTask = (async () => {
      // Kill the process group, including browser descendants. Never reuse it.
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      if (!exited) await new Promise(resolve => child.once('exit', resolve));
    })();
    return killTask;
  };
  const startupTimer = setTimeout(() => { startupReject(new Error('Browser launch timed out')); }, 45000);
  try { await startup; } catch (error) { await kill(); await fs.rm(working, { recursive: true, force: true }); throw error; }
  finally { clearTimeout(startupTimer); }
  const armIdle = () => {
    clearTimeout(idle);
    if (state.state !== 'running' || queued) return;
    idle = setTimeout(async () => {
      state = { ...state, state: 'stopped', failure: 'Session idle retention expired' };
      await kill(); await fs.rm(working, { recursive: true, force: true });
    }, config.idleTimeoutMs || 1800000);
    idle.unref();
  };

  async function publish(cmd, result) {
    const source = path.join(working, 'observations', cmd.id);
    const target = path.join(observations, cmd.id);
    await fs.mkdir(target);
    let bytes = 0;
    const files = await inventory(source).catch(() => []);
    const artifacts = [];
    for (const name of files) {
      if (name === 'results.json') continue;
      const sourceFile = await regularFile(source, name);
      const size = (await fs.stat(sourceFile)).size;
      if (bytes + size > MAX_ARTIFACT_BYTES || usedBytes + bytes + size > MAX_SESSION_BYTES || artifacts.length >= 1000) {
        result.warnings.push({ code: 'artifact-limit', message: `Artifact omitted by retention limit: ${clip(name, 200)}` });
        continue;
      }
      await fs.mkdir(path.dirname(path.join(target, name)), { recursive: true });
      await fs.copyFile(sourceFile, path.join(target, name));
      artifacts.push(name); bytes += size;
    }
    usedBytes += bytes;
    artifacts.push('results.json'); artifacts.sort();
    const full = { ...result, artifacts };
    await fs.writeFile(path.join(target, 'results.json'), JSON.stringify(full, null, 2), { flag: 'wx' });
    retained.set(cmd.id, new Set(artifacts));
    await fs.rm(source, { recursive: true, force: true });
    const summary = { ...full, checks: (full.checks || []).slice(0, 20).map(check => ({ ...check, name: clip(check.name, 120), ...(check.error ? { error: clip(check.error, 1000) } : {}) })), omittedChecks: Math.max(0, (full.checks || []).length - 20), warnings: full.warnings.slice(0, 20).map(w => ({ ...w, message: clip(w.message, 1000) })), omittedWarnings: Math.max(0, full.warnings.length - 20), artifacts: artifacts.slice(0, 30), omittedArtifacts: Math.max(0, artifacts.length - 30) };
    return { observation: cmd.id, summary, artifacts };
  }

  async function execute(cmd) {
    validateCommand(cmd);
    if (cmd.expectedInstance && cmd.expectedInstance !== instanceID) throw new Error('Session instance changed; refusing to use a restarted service');
    if (cmd.op === 'status') return { summary: { ...state, retainedObservations: retained.size }, artifacts: [] };
    if (state.state !== 'running') throw new Error(`Session is ${state.state}: ${state.failure || 'not running'}`);
    if (ids.has(cmd.id)) throw new Error('Observation ID already used; observations are immutable');
    if (cmd.op !== 'stop' && (ids.size >= MAX_OBSERVATIONS || usedBytes >= MAX_SESSION_BYTES)) throw new Error('Session retention limit reached; stop and start a new session');
    if (cmd.op === 'sync' && !config.root) throw new Error('Cannot sync a URL session');
    ids.add(cmd.id);
    let timer, result;
    try {
      result = await Promise.race([
        new Promise((resolve, reject) => { pending = { id: cmd.id, resolve, reject }; child.send(cmd); }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Command timed out after ${cmd.timeoutMs || 30000}ms; session invalidated`)), cmd.timeoutMs || 30000); }),
      ]);
      state = { ...state, ...Object.fromEntries(['state', 'browser', 'playwrightVersion', 'baseURL', 'fingerprint', 'loadedFingerprint', 'fixtureRevision'].map(key => [key, result[key]])), instanceID };
      result.instanceID = instanceID;
    } catch (error) {
      state = { ...state, state: 'failed', failure: errorText(error) };
      await kill();
      result = { ...state, observation: cmd.id, op: cmd.op, ok: false, counts: { total: 1, passed: 0, failed: 1 }, checks: [{ name: 'command', status: 'failed', error: errorText(error) }], warnings: [{ code: 'session-invalidated', message: 'Worker terminated before subsequent commands; final screenshot and trace may be unavailable' }], ...(cmd.script ? { scriptDigest: digest(cmd.script) } : {}) };
    } finally { clearTimeout(timer); pending = null; }
    const envelope = await publish(cmd, result);
    if (state.state !== 'running') { await kill(); await fs.rm(working, { recursive: true, force: true }); }
    return envelope;
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      // No CORS, no cookie auth, and no browser-origin requests, even if a page
      // discovers the control port. Token is only in the controller/client.
      const auth = Buffer.from(req.headers.authorization || '');
      const expected = Buffer.from(`Bearer ${config.token}`);
      if (req.headers.origin || auth.length !== expected.length || !crypto.timingSafeEqual(auth, expected)) { res.writeHead(403).end('Forbidden'); return; }
      const url = new URL(req.url, 'http://control');
      if (req.method === 'GET' && url.pathname === '/artifact') {
        const expectedInstance = url.searchParams.get('expectedInstance');
        if (expectedInstance && expectedInstance !== instanceID) throw new Error('Session instance changed; refusing restarted service artifacts');
        const id = url.searchParams.get('id'), name = url.searchParams.get('path');
        if (!validID(id) || !retained.get(id)?.has(name)) throw new Error('Unknown artifact');
        const file = await regularFile(path.join(observations, id), name);
        const bytes = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length }).end(bytes);
        return;
      }
      if (req.method !== 'POST' || url.pathname !== '/command') { res.writeHead(404).end('Not found'); return; }
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 90 * 1024 * 1024) throw new Error('Command exceeds 90 MiB');
        chunks.push(chunk);
      }
      const cmd = JSON.parse(Buffer.concat(chunks).toString());
      validateCommand(cmd);
      if (queued >= 32) throw new Error('Command queue is full');
      queued++; clearTimeout(idle);
      const task = queue.then(() => {
        // A transport timeout while waiting must not apply an abandoned action
        // later. Active commands still run under the controller's deadline.
        if (res.destroyed) throw new Error('Command cancelled before execution');
        return execute(cmd);
      });
      queue = task.catch(() => {});
      let envelope;
      try { envelope = await task; } finally { queued--; armIdle(); }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(envelope));
    } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: clip(errorText(error)) })); }
  });
  server.requestTimeout = 650000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  armIdle();
  return { server, endpoint: `http://127.0.0.1:${server.address().port}`, instanceID, close: async () => { clearTimeout(idle); state.state = 'stopped'; await kill(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await fs.rm(working, { recursive: true, force: true }); } };
}

async function main() {
  if (process.argv[2] === '--worker') return worker(JSON.parse(process.argv[3]), process.argv[4], process.argv[5]);
  const config = JSON.parse(await fs.readFile(process.argv[2] || '/session.json', 'utf8'));
  const service = await controller(config);
  const shutdown = async () => { await service.close(); process.exit(0); };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
}
module.exports = { controller, safeRelative, regularFile, inventory, materialize, Events, MAX_SOURCE_BYTES };
if (require.main === module) main().catch(error => { process.stderr.write(`${errorText(error)}\n`); process.exitCode = 1; });
