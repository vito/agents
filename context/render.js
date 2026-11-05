/* Shared trusted renderer. The loader passes data, never scripts from a gist. */
function renderContext(doc, questions, fallbackTitle) {
  'use strict';
  const kinds = ['glossary', 'fact', 'decision', 'design', 'result', 'question', 'note'];
  const fail = message => { throw new Error('Invalid Context schema: ' + message); };
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  if (!object(doc) || !Array.isArray(doc.blocks)) fail('expected a blocks array.');
  if (doc.version != null && doc.version !== 1) fail('unsupported version; re-export with a compatible context module.');
  const strings = (x, name) => {
    if (x == null) return [];
    if (!Array.isArray(x) || x.some(s => typeof s !== 'string')) fail(name + ' must be an array of strings.');
    return x;
  };
  const text = (x, name) => {
    if (x == null) return '';
    if (typeof x !== 'string') fail(name + ' must be text.');
    return x;
  };
  const boolean = (x, name) => {
    if (x == null) return false;
    if (typeof x !== 'boolean') fail(name + ' must be boolean.');
    return x;
  };
  const known = new Map(), numbered = new Map();
  // Validate the entire document before creating any cards or answer controls.
  const all = doc.blocks.map(b => {
    if (!object(b) || typeof b.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/.test(b.id)) fail('invalid block id.');
    if (known.has(b.id)) fail('duplicate block id: ' + b.id);
    if (!kinds.includes(b.kind)) fail('unknown kind for ' + b.id);
    if (!['', 'active', 'superseded', 'dropped', null, undefined].includes(b.status)) fail('unknown status for ' + b.id);
    if (![null, undefined, 'P0', 'P1', 'P2', 'P3'].includes(b.priority)) fail('unknown priority for ' + b.id);
    if (b.number != null && (!Number.isSafeInteger(b.number) || b.number < 1 || numbered.has(b.number))) fail('invalid or duplicate Q-number.');
    const normalized = {...b, text: text(b.text, 'text'), summary: text(b.summary, 'summary'), blocks: text(b.blocks, 'blocks'),
      tags: strings(b.tags, 'tags'), supersedes: strings(b.supersedes, 'supersedes'), pin: boolean(b.pin, 'pin')};
    if (!normalized.text.trim()) fail('empty text for ' + b.id);
    if (b.options != null && !Array.isArray(b.options)) fail('options must be an array.');
    const keys = new Set();
    normalized.options = (b.options || []).map(o => {
      if (!object(o) || typeof o.key !== 'string' || !o.key.trim() || typeof o.text !== 'string' || !o.text.trim() || keys.has(o.key)) fail('invalid or duplicate option for ' + b.id);
      keys.add(o.key);
      return {...o, recommended: boolean(o.recommended, 'recommended')};
    });
    known.set(b.id, normalized);
    if (b.number != null) numbered.set(b.number, normalized);
    return normalized;
  });
  const active = b => b.status !== 'superseded' && b.status !== 'dropped';
  const live = all.filter(active), gone = all.filter(b => b.status === 'superseded'), dropped = all.filter(b => b.status === 'dropped');
  // Missing metadata means a legacy JSON-only export. Present metadata must
  // be complete: silently defaulting malformed ownership could expose controls
  // for questions the exporting session cannot answer.
  const viewer = Object.hasOwn(doc, 'viewer') ? doc.viewer : {
    version: 1, title: 'Context', repo: '', lead: [],
    ownQuestions: live.filter(b => b.kind === 'question').map(b => b.id)
  };
  if (!object(viewer) || viewer.version !== 1) fail('unsupported or malformed viewer metadata (expected version 1).');
  if (typeof viewer.title !== 'string' || typeof viewer.repo !== 'string' ||
      !Array.isArray(viewer.lead) || !Array.isArray(viewer.ownQuestions)) fail('malformed viewer metadata.');
  if (viewer.repo && !/^[A-Za-z0-9][\w.-]*\/[\w.-]+$/.test(viewer.repo)) fail('viewer.repo must be owner/repo or empty.');
  for (const name of ['lead', 'ownQuestions']) {
    strings(viewer[name], 'viewer.' + name);
    if (new Set(viewer[name]).size !== viewer[name].length || viewer[name].some(id => !known.has(id))) fail('viewer.' + name + ' must contain unique known block ids.');
  }
  if (viewer.ownQuestions.some(id => known.get(id).kind !== 'question' || !active(known.get(id)))) fail('viewer.ownQuestions must name active questions.');
  // Exports from before titles were required say only the generic "Context";
  // the caller's fallback (a hosted gist's description) names them better.
  const fallback = typeof fallbackTitle === 'string' ? fallbackTitle.trim() : '';
  const generic = !viewer.title.trim() || viewer.title === 'Context';
  const config = {...viewer, title: generic && fallback ? fallback : viewer.title, questions: questions === true};
  document.body.dataset.title = config.title;
  document.title = config.title + (config.questions ? ' — open questions' : '');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const lit = s => esc(s).replace(/\*/g, '&#42;').replace(/~/g, '&#126;');
  const chip = (id, short = false) => {
    const b = known.get(id);
    if (!b) return '<code>' + lit(id) + '</code>';
    return `<a class="chip k-${b.kind}${active(b) ? '' : ' gone'}" href="#b-${lit(id)}" title="${short ? lit(id) : b.kind.toUpperCase()}">${short ? 'Q-' + b.number : lit(id)}</a>`;
  };
  const tokenID = token => known.has(token) ? token : (known.has(token.replace(/[._-]+$/, '')) ? token.replace(/[._-]+$/, '') : null);
  // Same leftmost token precedence and escaped emphasis pass as offline HTML.
  const token = /`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"'`]*[^\s<>"'`.,;:!?)\]])|\b([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)#(\d+)\b|\B#(\d+)\b|\b([a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+)|([&<>"'])|\bQ-(\d+)\b/g;
  function inline(s) {
    return s.replace(token, (match, code, label, url, bare, repo, issue, local, path, special, q) => {
      if (code) {
        if (known.has(code)) return chip(code);
        const b = /^Q-\d+$/.test(code) && numbered.get(Number(code.slice(2)));
        return b ? chip(b.id, true) : '<code>' + lit(code) + '</code>';
      }
      if (q) return numbered.has(Number(q)) ? chip(numbered.get(Number(q)).id, true) : 'Q-' + q;
      if (label) return `<a href="${lit(url)}">${lit(label)}</a>`;
      if (bare) return `<a href="${lit(bare)}">${lit(bare)}</a>`;
      if (repo) return `<a class="pr" href="https://github.com/${lit(repo)}/issues/${issue}">${lit(repo + '#' + issue)}</a>`;
      if (local) return config.repo ? `<a class="pr" href="https://github.com/${lit(config.repo)}/issues/${local}">#${local}</a>` : '#' + local;
      if (path) { const id = tokenID(path); return id ? chip(id) + lit(path.slice(id.length)) : lit(path); }
      return esc(match);
    }).replace(/\*\*(\S(?:.*?\S)?)\*\*/g, '<b>$1</b>').replace(/~~(\S(?:.*?\S)?)~~/g, '<s>$1</s>')
      .replace(/(^|[^\w*])\*([^*\s](?:[^*]*[^*\s])?)\*/g, '$1<i>$2</i>');
  }
  function refsOf(b) {
    const ids = new Set();
    for (const m of [b.text, b.summary, b.blocks, ...b.options.map(o => o.text)].join('\n').matchAll(token)) {
      let id;
      if (m[1]) id = known.has(m[1]) ? m[1] : (/^Q-\d+$/.test(m[1]) ? numbered.get(Number(m[1].slice(2)))?.id : null);
      else if (m[10]) id = numbered.get(Number(m[10]))?.id;
      else id = tokenID(m[8] || '');
      if (id && id !== b.id) ids.add(id);
    }
    return [...ids];
  }
  function markdown(s) {
    let out = '', mode = '', para = [], items = [], rows = [], fence = [], inFence = false;
    function flush() {
      if (mode === 'p') out += '<p>' + inline(para.join('\n')) + '</p>';
      if (mode === 'ul' || mode === 'ol') out += `<${mode}>` + items.map(i => '<li>' + inline(i) + '</li>').join('') + `</${mode}>`;
      if (mode === 'table') {
        const rule = r => /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(r), headed = rows.length > 1 && rule(rows[1]);
        out += '<table>' + rows.map((r, i) => {
          if (rule(r)) return '';
          const tag = headed && i === 0 ? 'th' : 'td';
          return '<tr>' + r.trim().replace(/^\||\|$/g, '').split('|').map(c => `<${tag}>${inline(c.trim())}</${tag}>`).join('') + '</tr>';
        }).join('') + '</table>';
      }
      mode = ''; para = []; items = []; rows = [];
    }
    for (const line of s.split('\n')) {
      const t = line.trim();
      if (inFence) {
        if (t.startsWith('```')) { out += '<pre>' + esc(fence.join('\n')) + '</pre>'; fence = []; inFence = false; }
        else fence.push(line);
        continue;
      }
      const kind = !t ? 'blank' : t.startsWith('```') ? 'fence' : /^#{1,6}\s/.test(t) ? 'heading' : t.startsWith('>') ? 'quote' : /^(-{3,}|\*{3,}|_{3,})$/.test(t) ? 'rule' : /^[-*+]\s+/.test(t) ? 'ul' : /^\d+[.)]\s+/.test(t) ? 'ol' : t.startsWith('|') ? 'table' : ['ul', 'ol'].includes(mode) && /^\s/.test(line) ? 'more' : 'p';
      if (kind === 'more') { items[items.length - 1] += '\n' + t; continue; }
      if (kind !== mode || !['p', 'ul', 'ol', 'table'].includes(kind)) flush();
      if (kind === 'fence') inFence = true;
      else if (kind === 'heading') out += '<p class="h">' + inline(t.replace(/^#+/, '').trim()) + '</p>';
      else if (kind === 'quote') out += '<blockquote>' + inline(t.slice(1).trim()) + '</blockquote>';
      else if (kind === 'rule') out += '<hr>';
      else if (['ul', 'ol'].includes(kind)) { mode = kind; items.push(t.replace(/^([-*+]|\d+[.)])\s+/, '')); }
      else if (kind === 'table') { mode = kind; rows.push(t); }
      else if (kind === 'p') { mode = kind; para.push(t); }
    }
    if (inFence) out += '<pre>' + esc(fence.join('\n')) + '</pre>';
    flush(); return out;
  }
  const rank = b => b.priority == null ? 4 : Number(b.priority[1]);
  const urgency = qs => qs.slice().sort((a, b) => rank(a) - rank(b) || Number(b.tags.includes('blocker')) - Number(a.tags.includes('blocker')) || (a.tags.includes('blocker') ? 0 : Number(b.pin) - Number(a.pin)));
  const priority = b => b.priority ? `<span class="prio ${b.priority.toLowerCase()}">${b.priority}</span>` : active(b) ? '<span class="prio pn">unprioritized</span>' : '';
  const holds = b => b.blocks ? `<span class="holds">blocks: ${inline(b.blocks)}</span>` : '';
  const summary = b => b.summary ? `<p class="tldr">${inline(b.summary)}</p>` : '';
  const rec = '<span class="rec">RECOMMENDED</span>';
  const tagsHtml = b => b.tags.map(t => `<span class="tag">#${lit(t)}</span>`).join('');
  const blocker = b => b.tags.includes('blocker') ? '<span class="badge">BLOCKER</span>' : '';
  let page = '';
  if (config.questions) {
    const asked = urgency(live.filter(b => b.kind === 'question' && config.ownQuestions.includes(b.id)));
    page = `<h1>${esc(config.title)} — open questions</h1>`;
    if (!asked.length) page += '<div class="sub">No open questions. <a href="index.html">The whole Context</a>.</div>\n';
    else {
      const urgent = asked.filter(b => b.priority === 'P0').length, loose = asked.filter(b => b.priority == null).length;
      page += `<div class="sub">${asked.length} open question(s)${urgent ? ', ' + urgent + ' P0' : ''}${loose ? ', ' + loose + ' unprioritized' : ''}, by priority: P0 first, unprioritized last. Pick an option for each one you can answer, add notes, then copy the generated prompt back to the agent. Answers stay in this browser only. <a href="index.html">The whole Context</a>.</div>\n`;
      page += asked.map(b => {
        const id = lit(b.id);
        return (`<section class="blk k-question q" id="q-${id}" data-id="${id}" data-q="${b.number == null ? '' : 'Q-' + b.number}"><div class="h"><span class="qn">${b.number == null ? '' : 'Q-' + b.number}</span>${priority(b)}<a class="bid" href="index.html#b-${id}">${id}</a>${blocker(b)}${holds(b)}${tagsHtml(b)}</div>` +
          summary(b) + `<details${b.summary ? '' : ' open'}><summary>More details</summary>${markdown(b.text)}</details><div class="answer">` +
          b.options.map(o => `<label><input type="radio" name="q-${id}" value="${esc(o.key)}" data-text="${esc(o.text)}"><b>${lit(o.key)}.</b> ${inline(o.text)}${o.recommended ? rec : ''}</label>`).join('') +
          '</div><textarea placeholder="Notes, another answer, or a question back…"></textarea><div class="row"><button class="secondary copy">Copy this answer</button></div></section>\n').replace(/href="#b-/g, 'href="index.html#b-');
      }).join('');
    }
    page += '<div id="dock"><div class="inner"><button id="gen">Generate prompt</button><button id="copy-all">Copy prompt</button><button class="secondary" id="clear">Clear answers</button><span class="toast" id="toast"></span><textarea id="prompt" readonly></textarea></div></div>';
  } else {
    const pinned = live.filter(b => b.pin), counts = new Map();
    // Body text only: a lower bound on composition cost, counted in Unicode
    // code points like Dang String.length (not JavaScript UTF-16 units).
    const pinnedChars = pinned.reduce((n, b) => n + Array.from(b.text).length, 0);
    live.forEach(b => b.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
    const tags = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
    const present = kinds.filter(k => live.some(b => b.kind === k));
    const refs = new Map(all.map(b => [b.id, refsOf(b)]));
    function card(b, featured) {
      const k = b.kind, id = lit(b.id), asks = k === 'question';
      let out = `<div class="blk k-${k}"${featured ? '' : ` id="b-${id}" data-kind="${k}" data-tags="${b.tags.map(t => tags.indexOf(t)).filter(i => i >= 0).join(' ')}"`}><div class="h"><span class="kind k-${k}">${k.toUpperCase()}</span>`;
      if (b.number != null) out += `<span class="qn">Q-${b.number}</span>`;
      out += (asks ? priority(b) : '') + (featured ? `<a class="bid" href="#b-${id}">${id}</a>` : `<span class="bid">${id}</span>`) + (asks && active(b) ? blocker(b) + holds(b) : '') + (b.pin ? '<span class="pin">📌 pinned</span>' : '') + tagsHtml(b) + '</div>';
      const links = [], by = b.status === 'superseded' ? all.filter(x => x.supersedes.includes(b.id)).map(x => x.id) : [];
      const chips = ids => ids.map(id => chip(id)).join(' ');
      if (by.length) links.push('<div>Superseded by ' + chips(by) + '</div>');
      else if (b.status === 'superseded') links.push('<div>Superseded</div>');
      else if (b.status === 'dropped') links.push('<div>Dropped: stopped mattering, with nothing replacing it</div>');
      if (b.supersedes.length) links.push('<div>Supersedes ' + chips(b.supersedes) + '</div>');
      if (refs.get(b.id).length) links.push('<div>References → ' + chips(refs.get(b.id)) + '</div>');
      const back = live.filter(x => refs.get(x.id).includes(b.id)).map(x => x.id);
      if (back.length) links.push('<div>Referenced by ← ' + chips(back) + '</div>');
      out += summary(b) + markdown(b.text);
      if (b.options.length) out += '<ul class="opts">' + b.options.map(o => `<li><b>${lit(o.key)}.</b> ${inline(o.text)}${o.recommended ? rec : ''}</li>`).join('') + '</ul>';
      return out + (links.length ? '<div class="links">' + links.join('') + '</div>' : '') + '</div>\n';
    }
    const badge = k => `<span class="kind k-${k}">${k.toUpperCase()}</span>`;
    page = `<h1>${esc(config.title)}</h1><div class="sub">${live.length} active block(s), ${pinned.length} pinned, ${gone.length} superseded${dropped.length ? ', ' + dropped.length + ' dropped' : ''}.</div>\n`;
    page += '<div class="legend">' + present.map(k => `<span>${badge(k)} ×${live.filter(b => b.kind === k).length}</span>`).join('') + `<span><span class="pin">📌 pinned</span> ×${pinned.length}</span><span class="sub">(pinned = candidates for bounded orientation, not automatic per-turn injection)</span></div>\n`;
    page += `<div class="sub pin-cost">Active pinned body text: ${pinnedChars} character(s), excluding headers, summaries and options.</div>\n`;
    if (pinnedChars > 12000) page += '<p class="pin-warning">Pinned bodies alone exceed the default 12000-character orientation budget. Keep a small current handoff and cross-task constraints pinned; unpin historical milestones with blockPin rather than deleting their records. Orientation will report omitted pins.</p>\n';
    const leading = config.lead.map(id => known.get(id)).filter(b => b && active(b));
    const asked = urgency(live.filter(b => b.kind === 'question' && !config.lead.includes(b.id)));
    page += '<nav>' + (leading.length ? '<a href="#glance">At a glance</a>' : '') + (asked.length ? '<a href="#questions">Open questions</a>' : '') + '<a href="#overview">Overview</a><a href="#blocks">Blocks</a>' + (gone.length ? '<a href="#superseded">Superseded</a>' : '') + (dropped.length ? '<a href="#dropped">Dropped</a>' : '') + '<a href="#about">About</a>' + (live.some(b => b.kind === 'question') ? '<a href="questions.html">Answer questions ↗</a>' : '') + '</nav>\n';
    if (leading.length) page += '<h2 id="glance">At a glance</h2>\n' + leading.map(b => card(b, true)).join('');
    if (asked.length) {
      const blocking = asked.filter(b => b.tags.includes('blocker')).length;
      page += `<h2 id="questions">Open questions</h2><div class="sub">Every active QUESTION block${blocking ? ', ' + blocking + ' blocking' : ''}, by priority: P0 first, unprioritized last, and within each, those tagged #blocker first, then pinned. Cite one by its Q-number; answering it means writing the decision that supersedes it. <a href="questions.html">Answer them in questions.html</a>.</div>\n` + asked.map(b => card(b, true)).join('');
    }
    page += '<h2 id="overview">Overview</h2>';
    if (pinned.length) page += '<h3>Pinned</h3><div>' + pinned.map(b => chip(b.id)).join(' ') + '</div>\n';
    if (tags.length) {
      const top = tags.slice(0, 12);
      page += '<h3>Kind × tag (top tags)</h3><table class="matrix"><tr><th></th>' + top.map(t => `<th>#${lit(t)}</th>`).join('') + '</tr>\n';
      present.forEach(k => { page += `<tr><td class="l">${badge(k)}</td>` + top.map(t => { const n = live.filter(b => b.kind === k && b.tags.includes(t)).length; return n ? `<td class="x">${n}</td>` : '<td></td>'; }).join('') + '</tr>\n'; });
      page += '</table>\n';
    }
    page += '<h2 id="blocks">Blocks</h2><div class="sub">Every active block in composition order: kind, then id. Click a kind or tag to filter.</div>\n<div class="filters"><button data-f="all" data-v="">all</button>' + present.map(k => `<button data-f="kind" data-v="${k}">${k.toUpperCase()}</button>`).join('') + '</div>';
    if (tags.length) page += '<div class="filters">' + tags.map((t, i) => `<button data-f="tag" data-v="${i}">#${lit(t)} ×${counts.get(t)}</button>`).join('') + '</div>';
    page += '\n<div id="blocks-list">\n' + live.map(b => card(b, false)).join('') + '</div>\n';
    if (gone.length) page += `<h2 id="superseded">Superseded</h2><div class="sub">Kept for the reasoning; never composed.</div><details class="sup"><summary>${gone.length} superseded block(s)</summary>\n` + gone.map(b => card(b, false)).join('') + '</details>\n';
    if (dropped.length) page += `<h2 id="dropped">Dropped</h2><div class="sub">Stopped mattering with nothing replacing them; kept for the record, never composed.</div><details class="sup"><summary>${dropped.length} dropped block(s)</summary>\n` + dropped.map(b => card(b, false)).join('') + '</details>\n';
    page += '<h2 id="about">About</h2><ul><li>Rendered by the context module\'s <code>exportContext</code> from a session\'s Context: a set of Blocks held beside the conversation.</li><li>Links between blocks are inferred from block ids mentioned in block text (references → and referenced by ←), plus each block\'s <code>supersedes</code> list.</li></ul>\n';
  }
  // Only HTML assembled by the escaping renderer above reaches this sink.
  const main = document.querySelector('main');
  main.className = config.questions ? 'qs' : '';
  main.innerHTML = page;
}
