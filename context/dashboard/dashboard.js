/* Cards come from gists: every string is shown as text, never as markup. */
(function dashboard() {
  'use strict';
  const kinds = ['decision', 'design', 'fact', 'result', 'glossary', 'note', 'question'];
  const cards = document.getElementById('cards');
  const status = document.getElementById('status');
  const error = document.getElementById('error');
  const filter = document.getElementById('filter');
  const refresh = document.getElementById('refresh');
  let all = [];

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

  function show() {
    const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = all.filter(c => {
      const hay = [c.title, c.description, c.repo, ...(c.highlights || []).map(h => h.text), ...(c.questions || []).map(q => q.text)].join(' ').toLowerCase();
      return words.every(w => hay.includes(w));
    });
    cards.replaceChildren(...shown.map(render));
    if (!all.length) cards.append(el('p', {class: 'empty'}, 'No gists with a context.json yet. Export one with exportContext and publish it as a gist.'));
    else if (!shown.length) cards.append(el('p', {class: 'empty'}, 'No Context matches the filter.'));
    return shown.length;
  }

  async function load(force) {
    refresh.disabled = true;
    try {
      const res = await fetch('/api/contexts' + (force ? '?refresh=1' : ''), {cache: 'no-store'});
      const data = await res.json();
      if (data.locked) {
        error.hidden = false;
        error.textContent = data.error;
        status.textContent = 'Locked';
        all = [];
        cards.replaceChildren();
        return;
      }
      all = Array.isArray(data.cards) ? data.cards : [];
      error.hidden = !data.error;
      error.textContent = data.error ? 'GitHub: ' + data.error + (all.length ? ' — showing the last cards listed.' : '') : '';
      show();
      const who = data.login ? ` of @${data.login}` : '';
      status.textContent = `${all.length} Context${all.length === 1 ? '' : 's'} in the gists${who} · listed ${ago(data.fetchedAt)}`;
      status.title = data.fetchedAt || '';
    } catch (e) {
      error.hidden = false;
      error.textContent = 'Cannot reach the dashboard server: ' + e.message;
      status.textContent = '';
    } finally {
      refresh.disabled = false;
    }
  }

  filter.addEventListener('input', show);
  refresh.addEventListener('click', () => load(true));
  load(false);
})();
