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
// /api/contexts as NDJSON messages, each stamped with when it arrived.
const stream = query => new Promise((resolve, reject) => {
  const start = Date.now(), messages = [];
  http.get({host: 'dash', port: 8080, path: '/api/contexts' + query, headers: {host: 'localhost:8080', cookie}}, res => {
    let buffer = '';
    res.setEncoding('utf8');
    res.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) if (line) messages.push({at: Date.now() - start, ...JSON.parse(line)});
    });
    res.on('end', () => {
      try {
        assert.equal(buffer, '');
        assert.equal(res.headers['content-type'], 'application/x-ndjson; charset=utf-8');
        const done = messages.filter(m => m.type === 'done');
        assert.equal(done.length, 1);
        assert.equal(messages.at(-1), done[0], 'done comes last');
        resolve({status: res.statusCode, messages, done: done[0], cards: messages.filter(m => m.type === 'card').map(m => m.card)});
      } catch (error) { reject(error); }
    });
  }).on('error', reject);
});
const newest = (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
const order = [hex('a'), hex('e'), hex('f'), hex('b'), hex('c'), hex('1')];

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
  await t.test('streams each card as soon as it is summarized', async () => {
    data = await stream('');
    assert.equal(data.status, 200);
    assert.equal(data.messages[0].type, 'login');
    assert.equal(data.messages[0].login, 'vito');
    assert.equal(data.done.error, '');
    const arrival = data.messages.filter(m => m.type === 'card').map(m => [m.card.id, m.at]);
    assert.deepEqual(arrival.slice(0, 3).map(([id]) => id).sort(), [hex('a'), hex('b'), hex('c')], 'the first page ahead of the second');
    assert.ok(arrival[2][1] + 700 < data.done.at, `first page cards came before the slow second page: ${JSON.stringify(arrival)} done at ${data.done.at}`);
    assert.deepEqual(data.cards.map(c => c.id).sort(), order.slice().sort(), 'gists without context.json left out');
  });

  await t.test('summarizes each context.json', async () => {
    const byID = Object.fromEntries(data.cards.map(c => [c.id, c]));
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
    const again = await stream('');
    assert.equal(again.done.fetchedAt, data.done.fetchedAt, 'a fresh listing is reused');
    assert.deepEqual(again.cards.map(c => c.id), order, 'replayed newest first');
    assert.deepEqual(again.cards, data.cards.slice().sort(newest));
    const forcing = stream('?refresh=1');
    await new Promise(resolve => setTimeout(resolve, 300));
    // A page loading mid-refresh joins it rather than starting another.
    const joined = await stream('');
    const forced = await forcing;
    assert.notEqual(forced.done.fetchedAt, data.done.fetchedAt);
    assert.equal(joined.done.fetchedAt, forced.done.fetchedAt);
    assert.deepEqual(joined.cards.slice().sort(newest), forced.cards.slice().sort(newest));
    assert.equal(forced.cards.length, order.length);
    const flaky = forced.cards.find(c => c.id === hex('1'));
    assert.equal(flaky.error, '', 'a transient failure is retried');
    assert.deepEqual(flaky.highlights.map(h => h.text), ['Served on the second try.']);
    assert.deepEqual(flaky.questions, [{id: 'questions/legacy', number: null, priority: null, text: 'A question from before viewer metadata.'}], 'without viewer metadata every question is open');
    const others = cards => cards.filter(c => c.id !== hex('1')).sort(newest);
    assert.deepEqual(others(forced.cards), others(data.cards));
    const s = await stats();
    assert.equal(s.notModified, 2, 'both listing pages revalidated with their ETags');
    assert.equal(s.requests['/user'], 1);
    assert.equal(s.requests['/gists?per_page=100'], 2);
    assert.equal(s.requests['/gists?per_page=100&page=2'], 2);
    const raw = Object.fromEntries(Object.entries(s.requests).filter(([k]) => k.startsWith('/raw/')).map(([k, n]) => [k.split('/')[2], n]));
    assert.deepEqual(raw, {[hex('a')]: 1, [hex('b')]: 1, [hex('c')]: 1, [hex('f')]: 1, [hex('1')]: 2}, 'each revision fetched once, the failed one twice');
    assert.deepEqual([...new Set(s.auth)], ['Bearer test-token']);
  });

  await t.test('a failed listing still shows the last cards, with the error', async () => {
    const last = (await stream('')).cards;
    await request('mockgh', '/__down', {});
    const failed = await stream('?refresh=1');
    assert.equal(failed.done.error, 'GitHub /gists: HTTP 503: Service unavailable');
    assert.deepEqual(failed.cards.slice().sort(newest), last);
    const reloaded = await stream('');
    assert.equal(reloaded.done.error, failed.done.error);
    assert.deepEqual(reloaded.cards, last);
  });
});
