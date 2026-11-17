'use strict';
// Single-user Context dashboard. The GitHub token never leaves this process:
// the browser only ever sees cards distilled from the user's context.json
// gists, rendered as text by dashboard.js. Gist content is data, as in the
// viewer: nothing here evaluates or serves it as markup.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const token = process.env.GITHUB_TOKEN || '';
const api = new URL((process.env.GITHUB_API || 'https://api.github.com').replace(/\/+$/, '') + '/');
const viewer = process.env.CONTEXT_VIEWER || 'https://vito.github.io/agents/context/v1/';
const port = Number(process.env.PORT || 8080);
// Only these Host headers are served, so a page elsewhere cannot rebind its
// own domain to this port and read the cards.
const hosts = new Set(['localhost', '127.0.0.1', '[::1]']);
// `dagger up` forwards the port on every interface, and anyone reaching it
// picks their own Host header: the cards also need this key, exchanged once
// (/?key=...) for an HttpOnly cookie.
const key = process.env.DASHBOARD_KEY || crypto.randomBytes(18).toString('base64url');
const cookieName = 'context-dashboard';
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
  const questions = active.filter(b => b.kind === 'question')
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

const pages = new Map(); // listing page URL -> {etag, gists}
const digests = new Map(); // raw URL -> digest or {error}
let state = {login: '', cards: [], fetchedAt: 0, error: ''};
let refreshing = null;

async function list() {
  const gists = [];
  let url = new URL('gists?per_page=100', api).href;
  while (url) {
    const cached = pages.get(url);
    const res = await github(url, cached && cached.etag);
    // A 304 costs no rate limit; its page still tells where the next one is.
    const page = res.notModified ? cached : {etag: res.etag, gists: Array.isArray(res.body) ? res.body : [], next: nextPage(res.link)};
    pages.set(url, page);
    gists.push(...page.gists);
    url = page.next;
  }
  return gists;
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({length: Math.min(size, items.length)}, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

async function refresh() {
  try {
    if (!state.login) {
      const user = await github(new URL('user', api).href);
      state.login = text(user.body && user.body.login);
    }
    const found = (await list())
      .filter(g => object(g) && typeof g.id === 'string' && /^[0-9a-f]+$/i.test(g.id) && object(g.files) && object(g.files['context.json']))
      .map(g => ({gist: g, file: g.files['context.json']}));
    const live = new Set();
    const failed = new Map(); // raw URL -> {error}, retried next refresh
    await pool(found, 6, async ({file}) => {
      const url = rawURL(file.raw_url);
      if (!url) return;
      live.add(url.href);
      if (digests.has(url.href)) return;
      if (Number.isSafeInteger(file.size) && file.size > maxBytes) { digests.set(url.href, {error: 'context.json is too large to summarize'}); return; }
      try { digests.set(url.href, digest(await fetchRaw(url))); }
      catch (error) { (error.transient ? failed : digests).set(url.href, {error: error.message}); }
    });
    for (const key of digests.keys()) if (!live.has(key)) digests.delete(key);
    const cards = found.map(({gist, file}) => {
      const url = rawURL(file.raw_url);
      if (!url) return card(gist, null, 'context.json has an unexpected raw URL');
      const d = digests.get(url.href) || failed.get(url.href);
      return d.error ? card(gist, null, d.error) : card(gist, d, '');
    });
    cards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    state = {login: state.login, cards, fetchedAt: Date.now(), error: ''};
  } catch (error) {
    // Keep the last good cards; say why they may be out of date.
    state = {...state, fetchedAt: Date.now(), error: error.message};
  }
}

function contexts(force) {
  if (!refreshing && (force || Date.now() - state.fetchedAt > stale)) {
    refreshing = refresh().finally(() => { refreshing = null; });
  }
  return refreshing || Promise.resolve();
}

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/dashboard.js': ['dashboard.js', 'text/javascript; charset=utf-8'],
  '/dashboard.css': ['dashboard.css', 'text/css; charset=utf-8'],
  '/context.css': ['context.css', 'text/css; charset=utf-8'],
};

function keyed(value) {
  const given = Buffer.from(String(value)), expected = Buffer.from(key);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function cookieKey(req) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === cookieName) {
      try { return decodeURIComponent(value.join('=')); } catch (_) { return ''; }
    }
  }
  return '';
}

const server = http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  const host = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (!hosts.has(host)) { res.writeHead(421, {'content-type': 'text/plain'}); res.end('Open the dashboard at http://localhost:' + port + '/\n'); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, {allow: 'GET, HEAD'}); res.end(); return; }
  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.has('key')) {
    if (!keyed(url.searchParams.get('key'))) { res.writeHead(403, {'content-type': 'text/plain'}); res.end('Wrong key: open the link the dashboard printed when it started.\n'); return; }
    // Trade the key for a cookie, and take it out of the address bar.
    res.writeHead(303, {location: '/', 'set-cookie': `${cookieName}=${encodeURIComponent(key)}; HttpOnly; SameSite=Strict; Path=/`});
    res.end();
    return;
  }
  if (url.pathname === '/api/contexts') {
    if (!keyed(cookieKey(req))) {
      res.writeHead(401, {'content-type': 'application/json', 'cache-control': 'no-store'});
      res.end(JSON.stringify({locked: true, error: 'Open the link the dashboard printed when it started (http://localhost:' + port + '/?key=…) to unlock it.', cards: []}));
      return;
    }
    await contexts(url.searchParams.has('refresh'));
    res.writeHead(state.error && !state.cards.length ? 502 : 200, {'content-type': 'application/json', 'cache-control': 'no-store'});
    res.end(JSON.stringify({login: state.login, fetchedAt: new Date(state.fetchedAt).toISOString(), error: state.error, cards: state.cards}));
    return;
  }
  const file = files[url.pathname];
  if (!file) { res.writeHead(404, {'content-type': 'text/plain'}); res.end('not found\n'); return; }
  res.writeHead(200, {'content-type': file[1], 'cache-control': 'no-cache'});
  res.end(fs.readFileSync(path.join(__dirname, file[0])));
});

if (!token) console.warn('GITHUB_TOKEN is empty: GitHub will refuse to list your gists.');
server.listen(port, '0.0.0.0', () => {
  const shown = process.env.DASHBOARD_KEY ? '<your key>' : encodeURIComponent(key);
  console.log(`Context dashboard: open http://localhost:${port}/?key=${shown} (with the port you forwarded)`);
});
