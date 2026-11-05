/* Only this trusted, versioned application executes. Gist files are data. */
(async function bootContext() {
  'use strict';
  const main = document.querySelector('main');
  const hosted = document.body.dataset.hosted === 'true';
  const params = new URLSearchParams(location.search);
  const validID = id => /^[0-9a-f]{1,64}$/i.test(id);
  function parseGist(value) {
    value = value.trim();
    if (validID(value)) return value.toLowerCase();
    let url;
    try { url = new URL(value); } catch (_) { throw new Error('Enter a hexadecimal gist ID or a https://gist.github.com/owner/id URL.'); }
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts.at(-1);
    if (url.protocol !== 'https:' || url.hostname !== 'gist.github.com' || url.username || url.password || url.port ||
        parts.length < 1 || parts.length > 2 || !validID(id)) throw new Error('Enter a hexadecimal gist ID or a https://gist.github.com/owner/id URL.');
    return id.toLowerCase();
  }
  function errorMessage(error) {
    main.textContent = 'Unable to load Context: ' + error.message;
    main.setAttribute('role', 'alert');
  }
  async function getJSON(url, credentials = 'omit') {
    const response = await fetch(url, {signal: AbortSignal.timeout(30000), credentials, redirect: 'error', referrerPolicy: 'no-referrer'});
    if (!response.ok) throw new Error(`HTTP ${response.status} loading Context. GitHub rate limits may require waiting before retrying.`);
    try { return await response.json(); }
    catch (_) { throw new Error('Invalid or incomplete JSON. Re-export and publish context.json.'); }
  }
  async function loadGist(id) {
    const gist = await getJSON('https://api.github.com/gists/' + id);
    const file = gist && gist.files && gist.files['context.json'];
    if (!file || typeof file !== 'object') throw new Error('This gist has no context.json.');
    if (file.truncated !== true && typeof file.content === 'string') {
      try { return JSON.parse(file.content); }
      catch (_) { throw new Error('The gist context.json is invalid or incomplete. Re-export and publish it.'); }
    }
    // A gist API response can omit content when its total inline budget is
    // exhausted. Never parse a truncated prefix, nor fetch an arbitrary URL.
    let raw;
    try { raw = new URL(file.raw_url); } catch (_) { throw new Error('Truncated context.json has no usable raw_url.'); }
    if (raw.protocol !== 'https:' || raw.hostname !== 'gist.githubusercontent.com' || raw.username || raw.password || raw.port) {
      throw new Error('Unexpected context.json raw_url; expected HTTPS gist.githubusercontent.com.');
    }
    return getJSON(raw.href);
  }
  function reveal() {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (_) { return; }
    const el = document.getElementById(id);
    if (!el) return;
    for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
    el.classList.remove('hide');
    el.scrollIntoView();
  }
  try {
    if (hosted && !params.has('gist')) {
      // This markup is constant; form values are never interpreted as HTML.
      main.innerHTML = '<h1>Context viewer</h1><p>Read a Context shared as a GitHub gist. The gist must contain <code>context.json</code>.</p>' +
        '<form id="open-gist"><label for="gist-input">Gist ID or URL</label><input id="gist-input" name="gist" required autocomplete="off" placeholder="https://gist.github.com/owner/id"><button type="submit">Open Context</button></form>' +
        '<p id="gist-error" role="alert"></p><p class="sub">The viewer fetches JSON only. Answers stay in this browser; nothing is written to the gist. Anyone with a secret gist link can read it.</p>';
      document.getElementById('open-gist').addEventListener('submit', event => {
        event.preventDefault();
        try {
          const url = new URL(location.href);
          url.search = ''; url.hash = '';
          url.searchParams.set('gist', parseGist(document.getElementById('gist-input').value));
          location.assign(url.href);
        } catch (error) { document.getElementById('gist-error').textContent = error.message; }
      });
      return;
    }
    let gist = null;
    if (hosted) {
      const id = params.get('gist');
      if (!validID(id || '')) throw new Error('Invalid gist ID; expected hexadecimal characters.');
      gist = id.toLowerCase();
      if (params.has('view') && !['context', 'questions'].includes(params.get('view'))) throw new Error('Unknown view; use context or questions.');
    }
    const questions = hosted ? params.get('view') === 'questions' : document.body.dataset.view === 'questions';
    let doc;
    if (gist) {
      document.body.dataset.gist = gist;
      doc = await loadGist(gist);
    } else {
      if (location.protocol === 'file:') throw new Error('Browsers block file:// JSON fetches. Serve this directory over HTTP, or export again with offlineHtml: true.');
      doc = await getJSON('./context.json', 'same-origin');
    }
    renderContext(doc, questions);
    if (hosted) {
      document.querySelectorAll('a[href^="index.html"],a[href^="questions.html"]').forEach(a => {
        const match = /^(index|questions)\.html(#.*)?$/.exec(a.getAttribute('href'));
        if (!match) return;
        const url = new URL(location.href);
        url.search = ''; url.searchParams.set('gist', gist);
        if (match[1] === 'questions') url.searchParams.set('view', 'questions');
        url.hash = match[2] || '';
        a.setAttribute('href', url.pathname + url.search + url.hash);
      });
    }
    initContextInteractions(questions);
    window.addEventListener('hashchange', reveal);
    reveal();
  } catch (error) { errorMessage(error); }
})();
