'use strict';
// Drives the dashboard bound as "dash" against the fake GitHub (github.cjs).
const {test} = require('node:test');
const http = require('node:http');
const assert = require('node:assert/strict');
const request = (host, path, headers) => new Promise((resolve, reject) => {
  http.get({host, port: 8080, path, headers}, res => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body}));
  }).on('error', reject);
});
const get = (path, host = 'localhost:8080') => request('dash', path, {host});
const stats = async () => JSON.parse((await request('mockgh', '/__stats', {})).body);
const hex = c => c.repeat(32);

test('Context dashboard', async t => {
  await t.test('serves only localhost, with a locked-down page', async () => {
    for (const host of ['evil.example:8080', 'evil.example', 'dash:8080']) {
      assert.equal((await get('/', host)).status, 421, host);
      assert.equal((await get('/api/contexts', host)).status, 421, host);
    }
    const page = await get('/', '127.0.0.1:8080');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-security-policy'], /default-src 'none'; script-src 'self';.*connect-src 'self'/);
    for (const f of ['/context.css', '/dashboard.css', '/dashboard.js']) assert.equal((await get(f)).status, 200, f);
    assert.match((await get('/context.css')).body, /--k-decision/);
    assert.equal((await get('/server.cjs')).status, 404);
  });

  let data;
  await t.test('lists every page and summarizes each context.json', async () => {
    const res = await get('/api/contexts');
    assert.equal(res.status, 200);
    data = JSON.parse(res.body);
    assert.equal(data.login, 'vito');
    assert.equal(data.error, '');
    const byID = Object.fromEntries(data.cards.map(c => [c.id, c]));
    assert.deepEqual(data.cards.map(c => c.id), [hex('a'), hex('e'), hex('f'), hex('b'), hex('c')], 'newest first; gists without context.json left out');
    const a = byID[hex('a')];
    assert.equal(a.title, 'Dashboard <b>build</b>');
    assert.equal(a.description, 'Dashboard gist');
    assert.equal(a.repo, 'vito/agents');
    assert.equal(a.public, false);
    assert.deepEqual([a.active, a.total, a.counts.decision, a.counts.note], [5, 7, 1, 0], 'superseded and dropped blocks are not counted');
    assert.deepEqual(a.highlights, [{id: 'designs/server', kind: 'design', text: 'A Dagger service holds the token server-side; the page only sees cards.'}]);
    assert.deepEqual([a.openQuestions, a.urgent], [2, 1]);
    assert.deepEqual(a.questions.map(q => [q.number, q.priority, q.text]), [[1, 'P0', 'Ship it? <img src=x onerror=window.pwned=1>'], [2, 'P2', 'Add a check later?']]);
    assert.equal(a.viewURL, 'https://vito.github.io/agents/context/v1/?gist=' + hex('a'));
    assert.equal(a.questionsURL, a.viewURL + '&view=questions');
    const b = byID[hex('b')];
    assert.equal(b.title, 'Legacy <i>export</i>', 'a generic title yields to the description');
    assert.equal(b.description, '');
    assert.equal(b.repo, '', 'an invalid repo is dropped');
    assert.equal(b.public, true);
    assert.match(b.highlights[0].text, /^Legacy decision with a very long text word/, 'a lone heading is skipped');
    assert.ok(b.highlights[0].text.length <= 240 && b.highlights[0].text.endsWith('…'));
    assert.equal(byID[hex('c')].error, 'context.json is not valid JSON');
    assert.equal(byID[hex('e')].error, 'context.json has an unexpected raw URL');
    assert.equal(byID[hex('f')].error, 'not a Context export: no blocks array');
  });

  await t.test('refreshes with conditional requests and fetches each revision once', async () => {
    const again = JSON.parse((await get('/api/contexts')).body);
    assert.equal(again.fetchedAt, data.fetchedAt, 'a fresh listing is reused');
    const forced = JSON.parse((await get('/api/contexts?refresh=1')).body);
    assert.notEqual(forced.fetchedAt, data.fetchedAt);
    assert.deepEqual(forced.cards, data.cards);
    const s = await stats();
    assert.equal(s.notModified, 2, 'both listing pages revalidated with their ETags');
    assert.equal(s.requests['/user'], 1);
    assert.equal(s.requests['/gists?per_page=100'], 2);
    assert.equal(s.requests['/gists?per_page=100&page=2'], 2);
    const raw = Object.entries(s.requests).filter(([k]) => k.startsWith('/raw/'));
    assert.deepEqual(raw.map(([k]) => k.split('/')[2]).sort(), [hex('a'), hex('b'), hex('c'), hex('f')]);
    assert.ok(raw.every(([, n]) => n === 1), JSON.stringify(raw));
    assert.deepEqual([...new Set(s.auth)], ['Bearer test-token']);
  });
});
