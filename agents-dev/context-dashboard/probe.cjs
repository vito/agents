'use strict';
// Drives the dashboard bound as "dash" (key "test-key") against the fake
// GitHub (github.cjs).
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
let cookie = '';
const get = (path, host = 'localhost:8080') => request('dash', path, cookie ? {host, cookie} : {host});
const stats = async () => JSON.parse((await request('mockgh', '/__stats', {})).body);
const hex = c => c.repeat(32);

test('Context dashboard', async t => {
  await t.test('serves only localhost, with a locked-down page', async () => {
    for (const host of ['evil.example:8080', 'evil.example', 'dash:8080']) {
      assert.equal((await get('/', host)).status, 421, host);
      assert.equal((await get('/api/contexts', host)).status, 421, host);
      assert.equal((await get('/?key=test-key', host)).status, 421, host);
    }
    const page = await get('/', '127.0.0.1:8080');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-security-policy'], /default-src 'none'; script-src 'self';.*connect-src 'self'/);
    for (const f of ['/context.css', '/dashboard.css', '/dashboard.js']) assert.equal((await get(f)).status, 200, f);
    assert.match((await get('/context.css')).body, /--k-decision/);
    assert.equal((await get('/server.cjs')).status, 404);
  });

  await t.test('survives a request it cannot parse', async () => {
    const reply = await new Promise((resolve, reject) => {
      const socket = require('node:net').connect(8080, 'dash', () => socket.write('GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'));
      let data = '';
      socket.on('data', c => data += c).on('end', () => resolve(data)).on('error', reject);
    });
    assert.match(reply, /^HTTP\/1\.1 400 /);
    assert.equal((await get('/')).status, 200);
  });

  await t.test('lists nothing until unlocked with the key', async () => {
    const locked = await get('/api/contexts');
    assert.equal(locked.status, 401);
    assert.deepEqual(JSON.parse(locked.body).cards, []);
    cookie = 'context-dashboard=test-keX';
    assert.equal((await get('/api/contexts')).status, 401);
    cookie = '';
    assert.equal((await get('/?key=test-keX')).status, 403);
    assert.equal((await get('/?key=')).status, 403);
    assert.equal((await stats()).requests['/user'], undefined, 'nothing reached GitHub');
    const unlock = await get('/?key=test-key');
    assert.equal(unlock.status, 303);
    assert.equal(unlock.headers.location, '/');
    const set = unlock.headers['set-cookie'][0];
    assert.match(set, /^context-dashboard=test-key; HttpOnly; SameSite=Strict; Path=\/$/);
    cookie = set.split(';')[0];
  });

  let data;
  await t.test('lists every page and summarizes each context.json', async () => {
    const res = await get('/api/contexts');
    assert.equal(res.status, 200);
    data = JSON.parse(res.body);
    assert.equal(data.login, 'vito');
    assert.equal(data.error, '');
    const byID = Object.fromEntries(data.cards.map(c => [c.id, c]));
    assert.deepEqual(data.cards.map(c => c.id), [hex('a'), hex('e'), hex('f'), hex('b'), hex('c'), hex('1')], 'newest first; gists without context.json left out');
    const a = byID[hex('a')];
    assert.equal(a.title, 'Dashboard <b>build</b>');
    assert.equal(a.description, 'Dashboard gist');
    assert.equal(a.repo, 'vito/agents');
    assert.equal(a.public, false);
    assert.deepEqual([a.active, a.total, a.counts.decision, a.counts.note], [5, 7, 1, 0], 'superseded and dropped blocks are not counted');
    assert.deepEqual(a.highlights, [{id: 'designs/server', kind: 'design', text: 'A Dagger service holds the token server-side; the page only sees cards.'}]);
    assert.equal(a.counts.question, 2);
    assert.deepEqual([a.openQuestions, a.urgent], [1, 1], 'only the questions page\'s own questions are open');
    assert.deepEqual(a.questions.map(q => [q.number, q.priority, q.text]), [[1, 'P0', 'Ship it? <img src=x onerror=window.pwned=1>']]);
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
    assert.equal(byID[hex('1')].error, 'HTTP 503 fetching context.json');
  });

  await t.test('refreshes with conditional requests, retrying only failed fetches', async () => {
    const again = JSON.parse((await get('/api/contexts')).body);
    assert.equal(again.fetchedAt, data.fetchedAt, 'a fresh listing is reused');
    const forced = JSON.parse((await get('/api/contexts?refresh=1')).body);
    assert.notEqual(forced.fetchedAt, data.fetchedAt);
    const flaky = forced.cards.find(c => c.id === hex('1'));
    assert.equal(flaky.error, '', 'a transient failure is retried');
    assert.deepEqual(flaky.highlights.map(h => h.text), ['Served on the second try.']);
    assert.deepEqual(flaky.questions, [{id: 'questions/legacy', number: null, priority: null, text: 'A question from before viewer metadata.'}], 'without viewer metadata every question is open');
    assert.deepEqual(forced.cards.filter(c => c.id !== hex('1')), data.cards.filter(c => c.id !== hex('1')));
    const s = await stats();
    assert.equal(s.notModified, 2, 'both listing pages revalidated with their ETags');
    assert.equal(s.requests['/user'], 1);
    assert.equal(s.requests['/gists?per_page=100'], 2);
    assert.equal(s.requests['/gists?per_page=100&page=2'], 2);
    const raw = Object.fromEntries(Object.entries(s.requests).filter(([k]) => k.startsWith('/raw/')).map(([k, n]) => [k.split('/')[2], n]));
    assert.deepEqual(raw, {[hex('a')]: 1, [hex('b')]: 1, [hex('c')]: 1, [hex('f')]: 1, [hex('1')]: 2}, 'each revision fetched once, the failed one twice');
    assert.deepEqual([...new Set(s.auth)], ['Bearer test-token']);
  });
});
