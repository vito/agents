/* Cards come from gists: every string is shown as text, never as markup. */
(function dashboard() {
  'use strict';
  const kinds = ['decision', 'design', 'fact', 'result', 'glossary', 'note', 'question'];
  const cards = document.getElementById('cards');
  const status = document.getElementById('status');
  const error = document.getElementById('error');
  const filter = document.getElementById('filter');
  const refresh = document.getElementById('refresh');
  const empty = document.getElementById('empty');
  const entries = new Map(); // gist id -> {card, node}, as shown

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v; else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null && c !== '') node.append(c);
    return node;
  }
  // Links only ever point where the server built them to: https URLs.
  const link = (href, text, attrs) => /^https:\/\//.test(href) ? el('a', {href, rel: 'noreferrer', ...attrs}, text) : text;

  function ago(iso) {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    for (const [unit, n] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
      if (s >= n) { const k = Math.floor(s / n); return `${k} ${unit}${k === 1 ? '' : 's'} ago`; }
    }
    return 'just now';
  }

  function render(c) {
    const meta = el('div', {class: 'meta'},
      el('span', {class: 'vis'}, c.public ? 'public' : 'secret'),
      c.repo ? link('https://github.com/' + c.repo, c.repo) : null,
      c.updatedAt ? el('time', {datetime: c.updatedAt, title: c.updatedAt}, 'updated ' + ago(c.updatedAt)) : null,
      c.gistURL ? link(c.gistURL, 'gist') : null);
    const card = el('article', {class: 'card' + (c.urgent ? ' urgent' : ''), 'data-gist': c.id},
      el('h2', null, link(c.viewURL, c.title)),
      c.description ? el('p', {class: 'desc sub'}, c.description) : null,
      meta);
    if (c.error) {
      card.append(el('p', {class: 'err'}, 'Cannot summarize: ' + c.error));
      return card;
    }
    const counts = el('div', {class: 'counts'});
    for (const k of kinds) {
      const n = c.counts && c.counts[k];
      if (n) counts.append(el('span', {class: 'chip k-' + k}, `${n} ${k}${n === 1 || k === 'glossary' ? '' : 's'}`));
    }
    if (counts.childNodes.length) card.append(counts);
    if (c.highlights && c.highlights.length) {
      card.append(el('ul', {class: 'highlights'}, ...c.highlights.map(h =>
        el('li', null, el('span', {class: 'kind k-' + h.kind}, h.kind.toUpperCase()), h.text))));
    }
    if (c.openQuestions) {
      const label = `${c.openQuestions} open question${c.openQuestions === 1 ? '' : 's'}` + (c.urgent ? ` · ${c.urgent} P0` : '') + ' →';
      card.append(el('div', {class: 'open-qs'},
        link(c.questionsURL, label),
        el('ul', null, ...c.questions.map(q => el('li', null,
          q.priority ? el('span', {class: 'prio ' + q.priority.toLowerCase()}, q.priority) : el('span', {class: 'prio pn'}, '—'),
          q.number ? el('span', {class: 'qn'}, 'Q-' + q.number) : null,
          q.text)))));
    }
    if (!card.querySelector('.counts, .highlights')) card.append(el('p', {class: 'empty'}, 'No active blocks.'));
    return card;
  }

  const matches = c => {
    const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = [c.title, c.description, c.repo, ...(c.highlights || []).map(h => h.text), ...(c.questions || []).map(q => q.text)].join(' ').toLowerCase();
    return words.every(w => hay.includes(w));
  };
  // Newest first, as the server sorts.
  const before = (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') || a.id.localeCompare(b.id);

  function emptyNote(done) {
    const shown = [...entries.values()].filter(e => !e.node.hidden).length;
    empty.hidden = shown > 0 || (!done && !entries.size);
    empty.textContent = entries.size ? 'No Context matches the filter.' : 'No gists with a context.json yet. Export one with exportContext and publish it as a gist.';
  }

  function show() {
    for (const e of entries.values()) e.node.hidden = !matches(e.card);
    emptyNote(!loading);
  }

  // Add or replace one card, in its place among those already shown.
  function upsert(c) {
    const node = render(c);
    node.hidden = !matches(c);
    const old = entries.get(c.id);
    if (old) old.node.remove();
    entries.set(c.id, {card: c, node});
    const next = [...entries.values()].filter(e => e.card.id !== c.id && before(c, e.card) < 0)
      .sort((a, b) => before(a.card, b.card))[0];
    cards.insertBefore(node, next ? next.node : null);
  }

  async function* lines(res) {
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const {value, done} = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), {stream: !done});
      const parts = buffer.split('\n');
      buffer = parts.pop();
      for (const part of parts) if (part.trim()) yield JSON.parse(part);
      if (done) break;
    }
    if (buffer.trim()) yield JSON.parse(buffer);
  }

  const count = n => `${n} Context${n === 1 ? '' : 's'}`;
  let loading = false;

  // Cards stream in as the server lists and summarizes them. A refresh
  // keeps the cards already shown until the listing says which are gone.
  async function load(force) {
    loading = true;
    refresh.disabled = true;
    const seen = new Set();
    let login = '', finished = null, locked = false;
    status.textContent = 'Listing your gists…';
    try {
      const res = await fetch('/api/contexts' + (force ? '?refresh=1' : ''), {cache: 'no-store'});
      if (res.status === 401) {
        const data = await res.json();
        error.hidden = false;
        error.textContent = data.error;
        status.textContent = 'Locked';
        entries.clear();
        cards.replaceChildren();
        locked = true;
        return;
      }
      if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
      for await (const message of lines(res)) {
        if (message.type === 'login') login = message.login || '';
        else if (message.type === 'card' && message.card && typeof message.card.id === 'string') {
          seen.add(message.card.id);
          upsert(message.card);
          status.textContent = `Listing your gists… ${count(seen.size)} so far`;
          emptyNote(false);
        } else if (message.type === 'done') finished = message;
      }
      if (!finished) throw new Error('the listing ended early');
      // Only a complete listing says which cards are gone.
      if (!finished.error) {
        for (const [id, e] of entries) if (!seen.has(id)) { e.node.remove(); entries.delete(id); }
      }
      error.hidden = !finished.error;
      error.textContent = finished.error ? 'GitHub: ' + finished.error + (entries.size ? ' — some cards may be out of date.' : '') : '';
      status.textContent = `${count(entries.size)} in the gists${login ? ` of @${login}` : ''} · listed ${ago(finished.fetchedAt)}`;
      status.title = finished.fetchedAt || '';
    } catch (e) {
      error.hidden = false;
      error.textContent = 'Cannot reach the dashboard server: ' + e.message;
      status.textContent = entries.size ? count(entries.size) + ' (incomplete)' : '';
    } finally {
      loading = false;
      refresh.disabled = false;
      if (locked) empty.hidden = true; else emptyNote(true);
    }
  }

  filter.addEventListener('input', show);
  refresh.addEventListener('click', () => load(true));
  load(false);
})();
