'use strict';
// Fake GitHub for the dashboard check: /user, two pages of /gists with
// ETags, raw files, and /__stats recording what the dashboard requested.
const http = require('node:http');
const base = 'http://mockgh:8080';
const hex = c => c.repeat(32);
const stats = {auth: [], requests: {}, notModified: 0};
const docs = {
  [hex('a')]: {
    version: 1,
    viewer: {version: 1, title: 'Dashboard <b>build</b>', repo: 'vito/agents', lead: ['designs/server', 'questions/auth'], ownQuestions: ['questions/auth']},
    question_count: 2,
    blocks: [
      {id: 'designs/server', kind: 'design', text: '```js\ncode()\n```\n\nA **Dagger service** holds the [token](https://example.com) server-side; the page only sees `cards`.\n\nSecond paragraph is not shown.', tags: [], pin: false, status: ''},
      {id: 'decisions/local', kind: 'decision', text: 'Single-user, localhost only.', tags: [], pin: true, status: 'active'},
      {id: 'facts/gh', kind: 'fact', text: 'gh tokens carry the gist scope.', tags: [], pin: false, status: ''},
      {id: 'questions/auth', kind: 'question', number: 1, priority: 'P0', summary: 'Ship it? <img src=x onerror=window.pwned=1>', text: 'x', options: [], status: ''},
      {id: 'questions/later', kind: 'question', number: 2, priority: 'P2', summary: 'Add a check later?', text: 'y', options: [], status: ''},
      {id: 'decisions/old', kind: 'decision', text: 'old', status: 'superseded'},
      {id: 'notes/gone', kind: 'note', text: 'gone', status: 'dropped'},
    ],
  },
  [hex('b')]: {blocks: [
    {id: 'facts/one', kind: 'fact', text: 'Legacy fact.'},
    {id: 'decisions/two', kind: 'decision', text: '# Heading\n\n- Legacy decision with a very long text ' + 'word '.repeat(80)},
  ], viewer: {version: 1, title: 'Context', repo: 'javascript:alert(1)', lead: [], ownQuestions: []}},
  [hex('f')]: {not: 'a context'},
};
const gist = (id, files, extra) => ({id, html_url: 'https://gist.github.com/vito/' + id, public: false, description: '', updated_at: '2026-11-01T00:00:00Z', files, ...extra});
const ctx = (id, rev, raw) => ({'context.json': {filename: 'context.json', size: 10, raw_url: raw || `${base}/raw/${id}/${rev}/context.json`}});
const pages = {
  1: [
    gist(hex('a'), ctx(hex('a'), 'r1'), {description: 'Dashboard gist', updated_at: '2026-11-05T12:00:00Z'}),
    gist(hex('b'), ctx(hex('b'), 'r1'), {description: 'Legacy <i>export</i>', public: true, updated_at: '2026-10-01T00:00:00Z'}),
    gist(hex('c'), ctx(hex('c'), 'r1'), {description: 'Broken', updated_at: '2026-09-01T00:00:00Z'}),
    gist(hex('d'), {'notes.md': {filename: 'notes.md', raw_url: base + '/raw/d'}}, {description: 'Not a context'}),
  ],
  2: [
    gist(hex('e'), ctx(hex('e'), 'r1', 'https://attacker.example/context.json'), {description: 'Evil raw URL'}),
    gist(hex('f'), ctx(hex('f'), 'r1'), {description: 'Not a Context export'}),
  ],
};
http.createServer((req, res) => {
  const url = new URL(req.url, base);
  stats.requests[url.pathname + url.search] = (stats.requests[url.pathname + url.search] || 0) + 1;
  if (url.pathname === '/__stats') { res.end(JSON.stringify(stats)); return; }
  stats.auth.push(req.headers.authorization || '');
  if (url.pathname === '/user') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({login: 'vito'})); return; }
  if (url.pathname === '/gists') {
    const n = Number(url.searchParams.get('page') || 1);
    const etag = `"page-${n}"`;
    if (req.headers['if-none-match'] === etag) { stats.notModified++; res.writeHead(304); res.end(); return; }
    res.setHeader('etag', etag);
    res.setHeader('content-type', 'application/json');
    if (n === 1) res.setHeader('link', `<${base}/gists?per_page=100&page=2>; rel="next", <${base}/gists?per_page=100&page=2>; rel="last"`);
    res.end(JSON.stringify(pages[n] || []));
    return;
  }
  const raw = /^\/raw\/([0-9a-f]+)\/r1\/context\.json$/.exec(url.pathname);
  if (raw) {
    if (raw[1] === hex('c')) { res.end('{"blocks": ['); return; }
    res.end(JSON.stringify(docs[raw[1]]));
    return;
  }
  res.writeHead(404); res.end('{}');
}).listen(8080, '0.0.0.0');
