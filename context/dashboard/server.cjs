'use strict';
// Single-user Context dashboard. The GitHub token never leaves this process:
// the browser only ever sees cards distilled from the user's context.json
// gists, rendered as text by dashboard.js. Gist content is data, as in the
// viewer: nothing here evaluates or serves it as markup.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const token = process.env.GITHUB_TOKEN || '';
const api = new URL((process.env.GITHUB_API || 'https://api.github.com').replace(/\/+$/, '') + '/');
const viewer = process.env.CONTEXT_VIEWER || 'https://vito.github.io/agents/context/v1/';
const port = Number(process.env.PORT || 8080);
// Only these Host headers are served, so a page elsewhere cannot rebind its
// own domain to this port and read the cards.
const hosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const stale = 60 * 1000; // a page load reuses a listing this fresh
const maxBytes = 20 * 1024 * 1024; // a context.json bigger than this is skipped
const kinds = ['glossary', 'fact', 'decision', 'design', 'result', 'question', 'note'];

const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' ? x : '';

async function github(url, etag) {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'context-dashboard',
    authorization: 'Bearer ' + token,
  };
  if (etag) headers['if-none-match'] = etag;
  const res = await fetch(url, {headers, redirect: 'error', signal: AbortSignal.timeout(30000)});
  if (res.status === 304) return {notModified: true};
  if (!res.ok) {
    let message = '';
    try { message = text((await res.json()).message); } catch (_) {}
    const limited = res.headers.get('x-ratelimit-remaining') === '0' ? ' (rate limited)' : '';
    throw new Error(`GitHub ${new URL(url).pathname}: HTTP ${res.status}${limited}${message ? ': ' + message : ''}`);
  }
  return {body: await res.json(), etag: res.headers.get('etag'), link: res.headers.get('link') || ''};
}

// Follow pagination only within the API: the token is never sent elsewhere.
function nextPage(link) {
  const match = /<([^>]+)>;\s*rel="next"/.exec(link);
  if (!match) return null;
  const next = new URL(match[1], api);
  return next.origin === api.origin ? next.href : null;
}

// Raw gist URLs carry the revision, so a parsed context.json is cached by it.
function rawURL(value) {
  let url;
  try { url = new URL(value); } catch (_) { return null; }
  if (url.username || url.password) return null;
  const githubRaw = url.protocol === 'https:' && url.hostname === 'gist.githubusercontent.com' && !url.port;
  return githubRaw || url.origin === api.origin ? url : null;
}

// A failure the next refresh should retry, unlike one the revision itself
// causes (bad JSON, not a Context), which is cached with it.
const transient = message => Object.assign(new Error(message), {transient: true});

async function fetchRaw(url) {
  const headers = {'user-agent': 'context-dashboard'};
  // Secret gists' raw files are readable without auth; only a self-hosted
  // API's own origin gets the token.
  if (url.origin === api.origin) headers.authorization = 'Bearer ' + token;
  let body;
  try {
    const res = await fetch(url, {headers, redirect: 'error', signal: AbortSignal.timeout(30000)});
    if (!res.ok) throw transient(`HTTP ${res.status} fetching context.json`);
    body = await res.text();
  } catch (error) {
    throw error.transient ? error : transient('cannot fetch context.json: ' + error.message);
  }
  if (Buffer.byteLength(body) > maxBytes) throw new Error('context.json is too large to summarize');
  try { return JSON.parse(body); } catch (_) { throw new Error('context.json is not valid JSON'); }
}

// Markdown to a one-paragraph plain-text excerpt. The browser shows it as
// text, so this is about legibility, not safety.
function excerpt(md, max = 240) {
  const paragraphs = md.replace(/```[\s\S]*?(```|$)/g, '\n\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  // A heading alone says less than the paragraph under it.
  const paragraph = paragraphs.find(p => !/^#{1,6}\s[^\n]*$/.test(p)) || paragraphs[0] || '';
  let s = paragraph
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  return s;
}

const priorities = {P0: 0, P1: 1, P2: 2, P3: 3};
const rank = b => priorities[b.priority] ?? 4;

// What a card says about one context.json, independent of its gist's
// metadata. Lenient where the viewer is strict: a card summarizes whatever
// it can, and the viewer reports what is wrong when the Context is opened.
function digest(doc) {
  if (!object(doc) || !Array.isArray(doc.blocks)) throw new Error('not a Context export: no blocks array');
  if (doc.version != null && doc.version !== 1) throw new Error('unsupported Context version');
  const blocks = doc.blocks.filter(b => object(b) && typeof b.id === 'string' && kinds.includes(b.kind) && typeof b.text === 'string');
  const active = blocks.filter(b => b.status !== 'superseded' && b.status !== 'dropped');
  const counts = Object.fromEntries(kinds.map(k => [k, active.filter(b => b.kind === k).length]));
  const viewer = object(doc.viewer) ? doc.viewer : {};
  const repo = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/.test(text(viewer.repo)) ? viewer.repo : '';
  const byId = new Map(active.map(b => [b.id, b]));
  const lead = (Array.isArray(viewer.lead) ? viewer.lead : []).map(id => byId.get(id)).filter(Boolean);
  const answers = active.filter(b => b.kind !== 'question');
  // What the exporter led with, else pins, else the first settled design or
  // decision: the card's summary.
  let highlights = lead.filter(b => b.kind !== 'question');
  if (!highlights.length) highlights = answers.filter(b => b.pin === true);
  if (!highlights.length) {
    for (const kind of ['design', 'decision', 'result', 'fact', 'note', 'glossary']) {
      highlights = answers.filter(b => b.kind === kind);
      if (highlights.length) break;
    }
  }
  // The questions page lists only the exporting session's own questions
  // (every one, for exports from before viewer metadata), so the card counts
  // what that page will show.
  const own = Array.isArray(viewer.ownQuestions) ? new Set(viewer.ownQuestions) : null;
  const questions = active.filter(b => b.kind === 'question' && (!own || own.has(b.id)))
    .map((b, i) => ({b, i, led: lead.includes(b) ? 0 : 1}))
    .sort((x, y) => rank(x.b) - rank(y.b) || x.led - y.led || x.i - y.i)
    .map(({b}) => b);
  return {
    title: text(viewer.title).trim(),
    repo,
    counts,
    total: blocks.length,
    active: active.length,
    highlights: highlights.slice(0, 2).map(b => ({id: b.id, kind: b.kind, text: excerpt(b.text)})),
    openQuestions: questions.length,
    urgent: questions.filter(b => b.priority === 'P0').length,
    questions: questions.slice(0, 3).map(b => ({
      id: b.id,
      number: Number.isSafeInteger(b.number) ? b.number : null,
      priority: b.priority in priorities ? b.priority : null,
      text: excerpt(text(b.summary) || b.text, 160),
    })),
  };
}

function card(gist, summary, error) {
  const description = text(gist.description).trim();
  // The viewer's title rule: a generic "Context" yields to the description.
  const named = summary && summary.title && summary.title !== 'Context' ? summary.title : '';
  const view = new URL(viewer);
  view.searchParams.set('gist', gist.id);
  const questions = new URL(view);
  questions.searchParams.set('view', 'questions');
  return {
    ...(summary || {}),
    id: gist.id,
    title: named || description || 'Untitled Context',
    description: named && description !== named ? description : '',
    public: gist.public === true,
    updatedAt: text(gist.updated_at),
    gistURL: /^https:\/\//.test(text(gist.html_url)) ? gist.html_url : '',
    viewURL: view.href,
    questionsURL: questions.href,
    error: error || '',
  };
}

const pages = new Map(); // listing page URL -> {etag, gists, next}
const digests = new Map(); // raw URL -> digest or {error}
// The last complete listing, and the refresh in flight, whose cards every
// page loading meanwhile receives as they come.
let state = {login: '', cards: [], fetchedAt: 0, error: ''};
let run = null;

const newest = (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);

async function listPage(url) {
  const cached = pages.get(url);
  const res = await github(url, cached && cached.etag);
  // A 304 costs no rate limit; its page still tells where the next one is.
  const page = res.notModified ? cached : {etag: res.etag, gists: Array.isArray(res.body) ? res.body : [], next: nextPage(res.link)};
  pages.set(url, page);
  return page;
}

// Listing pages in order, each next one fetched while the caller summarizes
// the one before.
async function* listing() {
  let next = listPage(new URL('gists?per_page=100', api).href);
  while (next) {
    const page = await next;
    next = page.next ? listPage(page.next) : null;
    // Handled when awaited; this only keeps an abandoned prefetch's failure
    // from taking the process down.
    if (next) next.catch(() => {});
    yield page.gists;
  }
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({length: Math.min(size, items.length)}, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

// One card, from the cache of its revision when there is one.
async function summarize(gist, file, live, failed) {
  const url = rawURL(file.raw_url);
  if (!url) return card(gist, null, 'context.json has an unexpected raw URL');
  live.add(url.href);
  if (!digests.has(url.href)) {
    if (Number.isSafeInteger(file.size) && file.size > maxBytes) digests.set(url.href, {error: 'context.json is too large to summarize'});
    else {
      try { digests.set(url.href, digest(await fetchRaw(url))); }
      catch (error) { (error.transient ? failed : digests).set(url.href, {error: error.message}); }
    }
  }
  const d = digests.get(url.href) || failed.get(url.href);
  return d.error ? card(gist, null, d.error) : card(gist, d, '');
}

function refresh() {
  const r = {login: state.login, cards: [], listeners: new Set()};
  const emit = message => { for (const listener of r.listeners) listener(message); };
  run = r;
  (async () => {
    try {
      if (!r.login) {
        const user = await github(new URL('user', api).href);
        r.login = text(user.body && user.body.login);
        emit({type: 'login', login: r.login});
      }
      const live = new Set();
      const failed = new Map(); // raw URL -> {error}, retried next refresh
      for await (const gists of listing()) {
        // Newest first within each page; the page sorts across pages.
        const found = gists
          .filter(g => object(g) && typeof g.id === 'string' && /^[0-9a-f]+$/i.test(g.id) && object(g.files) && object(g.files['context.json']))
          .sort((a, b) => text(b.updated_at).localeCompare(text(a.updated_at)));
        await pool(found, 6, async gist => {
          const c = await summarize(gist, gist.files['context.json'], live, failed);
          r.cards.push(c);
          emit({type: 'card', card: c});
        });
      }
      for (const key of digests.keys()) if (!live.has(key)) digests.delete(key);
      state = {login: r.login, cards: r.cards.slice().sort(newest), fetchedAt: Date.now(), error: ''};
    } catch (error) {
      // Keep the last good cards, updated by whatever this run got to; say
      // why they may be out of date.
      const merged = new Map(state.cards.map(c => [c.id, c]));
      for (const c of r.cards) merged.set(c.id, c);
      const streamed = new Set(r.cards.map(c => c.id));
      for (const c of state.cards) if (!streamed.has(c.id)) emit({type: 'card', card: c});
      state = {login: r.login, cards: [...merged.values()].sort(newest), fetchedAt: Date.now(), error: error.message};
    }
    run = null;
    emit({type: 'done', fetchedAt: new Date(state.fetchedAt).toISOString(), error: state.error});
  })();
  return r;
}

// Stream the cards as NDJSON: login, then each card as soon as it is known,
// then done. A complete listing fresh enough is replayed at once.
async function streamContexts(res, force) {
  res.writeHead(200, {'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store'});
  const send = message => res.write(JSON.stringify(message) + '\n');
  const r = run || (force || Date.now() - state.fetchedAt > stale ? refresh() : null);
  if (!r) {
    send({type: 'login', login: state.login});
    for (const c of state.cards) send({type: 'card', card: c});
    send({type: 'done', fetchedAt: new Date(state.fetchedAt).toISOString(), error: state.error});
    res.end();
    return;
  }
  // Catch up on the run so far, then follow it; nothing runs in between.
  if (r.login) send({type: 'login', login: r.login});
  for (const c of r.cards) send({type: 'card', card: c});
  await new Promise(resolve => {
    const listener = message => { send(message); if (message.type === 'done') resolve(); };
    r.listeners.add(listener);
    res.on('close', () => { r.listeners.delete(listener); resolve(); });
  });
  res.end();
}

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/dashboard.js': ['dashboard.js', 'text/javascript; charset=utf-8'],
  '/dashboard.css': ['dashboard.css', 'text/css; charset=utf-8'],
  '/context.css': ['context.css', 'text/css; charset=utf-8'],
};

const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {
    // Whatever a request does, the server outlives it.
    console.error('request failed:', error.message);
    if (!res.headersSent) res.writeHead(500, {'content-type': 'text/plain'});
    res.end();
  });
});

async function handle(req, res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  const host = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (!hosts.has(host)) { res.writeHead(421, {'content-type': 'text/plain'}); res.end('Open the dashboard at http://localhost:' + port + '/\n'); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, {allow: 'GET, HEAD'}); res.end(); return; }
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch (_) { res.writeHead(400, {'content-type': 'text/plain'}); res.end('bad request\n'); return; }
  if (url.pathname === '/api/contexts') {
    await streamContexts(res, url.searchParams.has('refresh'));
    return;
  }
  const file = files[url.pathname];
  if (!file) { res.writeHead(404, {'content-type': 'text/plain'}); res.end('not found\n'); return; }
  res.writeHead(200, {'content-type': file[1], 'cache-control': 'no-cache'});
  res.end(fs.readFileSync(path.join(__dirname, file[0])));
}

if (!token) console.warn('GITHUB_TOKEN is empty: GitHub will refuse to list your gists.');
server.listen(port, '0.0.0.0', () => {
  console.log(`Context dashboard: open http://localhost:${port}/ (with the port you forwarded)`);
});
