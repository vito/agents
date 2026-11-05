/* Shared by portable, hosted and self-contained pages. */
function initContextInteractions(questions) {
  'use strict';
  if (!questions) {
    let active = {kind: null, tag: null};
    function apply() {
      document.querySelectorAll('#blocks-list .blk').forEach(el => {
        const ok = (!active.kind || el.dataset.kind === active.kind) &&
          (!active.tag || (' ' + el.dataset.tags + ' ').includes(' ' + active.tag + ' '));
        el.classList.toggle('hide', !ok);
      });
      document.querySelectorAll('.filters button').forEach(b => {
        b.classList.toggle('on', active[b.dataset.f] === b.dataset.v);
      });
    }
    document.querySelectorAll('.filters button').forEach(b => {
      b.addEventListener('click', () => {
        if (b.dataset.f === 'all') active = {kind: null, tag: null};
        else active[b.dataset.f] = active[b.dataset.f] === b.dataset.v ? null : b.dataset.v;
        apply();
      });
    });
    return;
  }
  const body = document.body;
  const legacyGist = location.hostname === 'gistpreview.github.io' && (/^\?([0-9a-f]+)/.exec(location.search) || [])[1];
  // Gist answers survive title/Q-number changes. Portable files retain their
  // historical path-and-title namespace, then use stable block ids within it.
  const gist = body.dataset.gist || legacyGist;
  const KEY = 'context-answers:' + (gist || location.pathname + ':' + body.dataset.title);
  const legacyKey = 'context-answers:' + (gist || location.pathname) + ':' + body.dataset.title;
  // Pages exported before titles were required were all titled "Context";
  // a retitled re-export at the same path picks up their answers.
  const untitledKey = gist ? legacyKey : 'context-answers:' + location.pathname + ':Context';
  let state = Object.create(null);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(legacyKey) || localStorage.getItem(untitledKey) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [id, value] of Object.entries(saved)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) state[id] = value;
      }
    }
  } catch (_) { /* Storage may be disabled or hold a corrupt old value. */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {} }
  function entry(id) { return state[id] || (state[id] = {}); }
  const cards = [...document.querySelectorAll('section.q')];
  const radios = c => [...c.querySelectorAll('input[type=radio]')];
  function picked(c) {
    const s = state[c.dataset.id] || {};
    // Do not reuse a pick when an option's key or text has changed.
    return radios(c).find(r => r.value === s.choice && r.dataset.text === s.text) || null;
  }
  function notes(c) { const n = (state[c.dataset.id] || {}).notes; return typeof n === 'string' ? n.trim() : ''; }
  const answered = c => !!(picked(c) || notes(c));
  function mark(c) { c.classList.toggle('answered', answered(c)); }
  function line(c) {
    const r = picked(c), n = notes(c);
    return '- ' + c.dataset.q + ' (' + c.dataset.id + ') → ' +
      (r ? r.value + ' — ' + r.dataset.text : 'no option picked') +
      (n ? '. Notes: ' + n.replace(/\s+/g, ' ') : '') + '\n';
  }
  function preamble() {
    return 'Answers to open questions (context export "' + body.dataset.title + '"). ' +
      'Answer each one by writing the DECISION that settles it with blockWrite, superseding the question by its id ' +
      '(in parentheses after its Q-number, which can change across sessions). Where the notes push back or ask something, reply first instead of deciding.\n\n';
  }
  function prompt() { const a = cards.filter(answered); return a.length ? preamble() + a.map(line).join('') : ''; }
  function show(t) { const p = document.getElementById('prompt'); p.style.display = 'block'; p.value = t; }
  function toast(t) { const el = document.getElementById('toast'); el.textContent = t; setTimeout(() => { el.textContent = ''; }, 2000); }
  function fallback(t) {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied.'); } catch (_) { toast('Copy failed: select the prompt and copy it.'); }
    ta.remove();
  }
  function copy(t) {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(() => toast('Copied.'), () => fallback(t));
    else fallback(t);
  }
  cards.forEach(c => {
    const id = c.dataset.id, s = state[id] || {}, ta = c.querySelector('textarea');
    radios(c).forEach(r => {
      r.checked = r === picked(c);
      r.addEventListener('change', () => { const e = entry(id); e.choice = r.value; e.text = r.dataset.text; save(); mark(c); });
    });
    ta.value = typeof s.notes === 'string' ? s.notes : '';
    ta.addEventListener('input', () => { entry(id).notes = ta.value; save(); mark(c); });
    c.querySelector('button.copy').addEventListener('click', () => {
      if (!answered(c)) { toast('Pick an option or write a note first.'); return; }
      const t = preamble() + line(c); show(t); copy(t);
    });
    mark(c);
  });
  document.getElementById('gen').addEventListener('click', () => show(prompt() || 'Pick an option or write a note first.'));
  document.getElementById('copy-all').addEventListener('click', () => {
    const t = prompt(); if (!t) { toast('Nothing answered yet.'); return; } show(t); copy(t);
  });
  document.getElementById('clear').addEventListener('click', () => {
    if (!confirm('Clear every answer on this page?')) return;
    state = Object.create(null); save();
    cards.forEach(c => { radios(c).forEach(r => { r.checked = false; }); c.querySelector('textarea').value = ''; mark(c); });
    const p = document.getElementById('prompt'); p.value = ''; p.style.display = 'none';
  });
}
