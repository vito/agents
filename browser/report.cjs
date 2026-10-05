'use strict';

// Renders run and session results as text for the calling agent. The JSON
// (results.json, summary.json) stays the machine contract; this is display only,
// so it favors what an agent looks for first and bounds everything else.
const CHECK_LINES = 12;
const SCRIPT_LINES = 80;
const SCRIPT_CHARS = 8000;
const NOTABLE = 5;
const INSPECT_CHARS = 8000;
const STANDARD_ARTIFACTS = ['screenshot.png', 'results.json', 'trace.zip', 'console.json', 'network.json', 'pageerrors.json'];
const HEALTH_WARNINGS = ['page-errors', 'network-failures', 'http-errors', 'console-errors', 'unknown-loaded-source', 'command-error'];

const clip = (value, n) => { const text = String(value ?? ''); return text.length > n ? `${text.slice(0, n - 1)}…` : text; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const duration = ms => typeof ms !== 'number' ? null : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
const fingerprint = value => value ? `source ${clip(value, /^sha256:/.test(value) ? 20 : 32)}` : null;

function elapsed(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor(s / 60) % 60}m`;
}

// Error text with real newlines, without ANSI colors, blank lines, a leading
// "Error: " or stack frames; the script line of the first user frame is kept.
function errorLines(error) {
  const lines = String(error ?? '').replace(/\x1b\[[0-9;]*m/g, '').split('\n');
  const frame = lines.map(line => /^\s+at .*<anonymous>:(\d+):(\d+)/.exec(line)).find(Boolean);
  const kept = lines.filter(line => line.trim() && !/^\s+at /.test(line)).map((line, i) => i === 0 ? line.replace(/^Error: /, '') : line.trimEnd());
  // AsyncFunction bodies start on line 3 of their generated source.
  if (frame && Number(frame[1]) > 2) kept.push(`(script line ${Number(frame[1]) - 2})`);
  return kept;
}

function headline(ok, counts, details) {
  const { total = 0, failed = 0 } = counts || {};
  const text = failed ? `${failed} of ${plural(total, 'check')} failed` : total ? `${plural(total, 'check')} passed` : 'no checks';
  return `${ok ? '✓' : '✗'} ${[text, ...details].filter(Boolean).join(' · ')}`;
}

function checkLines(checks) {
  const out = [];
  for (const check of checks.filter(check => check.status === 'failed')) {
    const [first = 'failed', ...rest] = errorLines(check.error);
    const shown = rest.slice(0, CHECK_LINES - 1);
    out.push(`  ✗ ${clip(check.name, 120)}: ${clip(first, 500)}`, ...shown.map(line => `      ${clip(line, 500)}`));
    if (rest.length > shown.length) out.push(`      … ${rest.length - shown.length} more lines in results.json`);
  }
  const passed = checks.filter(check => check.status === 'passed').map(check => check.name);
  if (passed.length) out.push(`  ✓ ${clip(passed.join(', '), 400)}`);
  return out;
}

// Script console output in full, up to a cap, separate from page logs.
function scriptLines(entries) {
  if (!entries.length) return [];
  const out = ['script:'];
  let chars = 0, omitted = 0;
  for (const entry of entries) {
    for (const line of `${entry.type === 'error' ? 'error: ' : ''}${entry.text}`.split('\n')) {
      if (out.length > SCRIPT_LINES || chars > SCRIPT_CHARS) { omitted++; continue; }
      out.push(`  ${clip(line, 1000)}`);
      chars += line.length;
    }
  }
  if (omitted) out.push(`  … ${plural(omitted, 'more line')} in console.json`);
  return out;
}

// One health line; details only for the signals that are nonzero.
function pageLines({ console: entries, pageErrors, network }) {
  const failed = network.filter(event => event.type === 'failed');
  const http = network.filter(event => event.type === 'response' && event.status >= 400);
  const types = {};
  for (const entry of entries) types[entry.type] = (types[entry.type] || 0) + 1;
  const byType = Object.entries(types).sort((a, b) => b[1] - a[1]).map(([type, n]) => `${n} ${type}`).join(', ');
  const out = [`page: ${[plural(pageErrors.length, 'error'), plural(failed.length, 'failed request'), plural(http.length, 'HTTP error'), `${entries.length} console${byType ? ` (${byType})` : ''}`].join(' · ')}`];
  const more = (list, label) => { if (list.length > NOTABLE) out.push(`  … ${list.length - NOTABLE} more ${label}`); };
  for (const error of pageErrors.slice(0, NOTABLE)) out.push(`  error: ${clip(errorLines(error)[0] ?? '', 300)}`);
  more(pageErrors, 'page errors in pageerrors.json');
  for (const event of failed.slice(0, NOTABLE)) out.push(`  failed: ${clip(event.url, 200)}${event.error ? ` (${clip(event.error, 120)})` : ''}`);
  more(failed, 'failed requests in network.json');
  for (const event of http.slice(0, NOTABLE)) out.push(`  HTTP ${event.status}: ${clip(event.url, 200)}`);
  more(http, 'HTTP errors in network.json');
  const notable = entries.filter(entry => entry.type === 'error' || entry.type === 'warning');
  for (const entry of notable.slice(0, NOTABLE)) out.push(`  console.${entry.type}: ${clip(String(entry.text).split('\n')[0], 300)}`);
  more(notable, 'console errors/warnings in console.json');
  return out;
}

function artifactLine(artifacts = [], omitted = 0) {
  const named = artifacts.filter(name => !STANDARD_ARTIFACTS.includes(name));
  const standard = STANDARD_ARTIFACTS.filter(name => artifacts.includes(name));
  const extra = omitted ? ` +${omitted} more` : '';
  if (!named.length) return `artifacts: ${standard.join(', ')}${extra}`;
  return `artifacts: ${named.join(', ')}${extra}${standard.length ? ` (+ ${standard.join(', ')})` : ''}`;
}

// A run's full results.json.
function renderRun(result) {
  const browser = [result.browser?.name, result.browser?.version].filter(Boolean).join(' ');
  const lines = [headline(result.ok, result.counts, [browser, fingerprint(result.fingerprint), duration(result.durationMs)])];
  if (result.infrastructureError) lines.push(`infrastructure error: ${errorLines(result.infrastructureError).slice(0, CHECK_LINES).join('\n  ')}`);
  lines.push(...checkLines(result.checks || []));
  lines.push(...scriptLines((result.console || []).filter(entry => entry.source === 'script')));
  lines.push(...pageLines({ console: (result.console || []).filter(entry => entry.source !== 'script'), pageErrors: result.pageErrors || [], network: result.network || [] }));
  for (const error of result.captureErrors || []) lines.push(`capture: ${clip(errorLines(error)[0] ?? '', 300)}`);
  lines.push(artifactLine(result.artifacts));
  return `${lines.join('\n')}\n`;
}

// One line per session for status listings.
function renderStatus(summary) {
  const state = summary.state === 'running' ? 'live' : `closed (${summary.state}${summary.failure ? `: ${clip(errorLines(summary.failure)[0] ?? '', 160)}` : ''})`;
  const last = summary.observation || summary.lastObservation;
  return [
    `${summary.session} ${state}`,
    summary.url ? clip(summary.url, 200) : null,
    summary.state === 'running' && typeof summary.idleMs === 'number' ? `idle ${elapsed(summary.idleMs)}` : null,
    last ? `last ${last}` : null,
  ].filter(Boolean).join(' · ');
}

function eventLine(kind, event) {
  if (kind === 'network') return event.type === 'request' ? `→ ${event.method} ${event.url}` : event.type === 'response' ? `← ${event.status} ${event.url}` : `✗ ${event.url}${event.error ? ` (${event.error})` : ''}`;
  if (kind === 'console') return `${event.source === 'script' ? 'script ' : ''}${event.type}: ${event.text}`;
  return errorLines(event.text).slice(0, 3).join(' ⏎ ');
}

function inspectionLines(kind, inspection, events) {
  if (!inspection) return [];
  const out = [`${kind}: ${inspection.artifact}`];
  const body = events ? events.map(event => eventLine(kind, event)).join('\n') : inspection.preview;
  out.push(...clip(body, INSPECT_CHARS).split('\n').filter(line => line !== '').map(line => `  ${clip(line, 1000)}`));
  if (events) {
    const notes = [`next cursor ${inspection.nextCursor}`];
    if (inspection.hasMore) notes.push('more available: pass since');
    if (inspection.dropped) notes.push(`${inspection.dropped} dropped`);
    out.push(`  (${notes.join(' · ')})`);
  } else if (inspection.previewTruncated || (body || '').length > INSPECT_CHARS) out.push(`  … truncated; full text in ${inspection.artifact}`);
  return out;
}

// A session command's summary plus the evidence files fetched with it.
// files: console/network/pageerrors event lists and, for inspections of
// events, the inspected events.
function renderSession(command, summary, files = {}) {
  if (command.op === 'status') {
    const browser = [summary.browser?.name, summary.browser?.version].filter(Boolean).join(' ');
    const head = `${summary.state === 'running' ? '✓ live' : `✗ ${summary.state}`} · ${[browser, summary.playwrightVersion && `Playwright ${summary.playwrightVersion}`, fingerprint(summary.fingerprint)].filter(Boolean).join(' · ')}`;
    return `${[head, summary.baseURL ? `baseURL: ${summary.baseURL}` : null, summary.failure ? `failure: ${clip(summary.failure, 1000)}` : null].filter(Boolean).join('\n')}\n`;
  }
  const label = command.op === 'exec' ? null : command.op === 'inspect' ? `inspect ${command.kind}` : command.op === 'sync' ? 'sync' : 'stopped';
  const details = [label, command.op === 'sync' ? fingerprint(summary.fingerprint) : null, summary.url ? clip(summary.url, 160) : null, duration(summary.durationMs)];
  const lines = [command.op === 'exec' ? headline(summary.ok, summary.counts, details) : `${summary.ok ? '✓' : '✗'} ${details.filter(Boolean).join(' · ')}`];
  if (summary.state && summary.state !== 'running' && command.op !== 'stop') lines.push(`session ${summary.state}${summary.failure ? `: ${clip(errorLines(summary.failure)[0] ?? '', 300)}` : ''}; start a new session`);
  for (const warning of (summary.warnings || []).filter(w => w.code === 'command-error')) lines.push(`error: ${errorLines(warning.message).slice(0, CHECK_LINES).join('\n  ')}`);
  lines.push(...checkLines(summary.checks || []));
  const consoleEvents = files.console || [];
  lines.push(...scriptLines(consoleEvents.filter(event => event.source === 'script')));
  if (command.op === 'inspect') lines.push(...inspectionLines(command.kind, summary.inspection, files.inspected));
  lines.push(...pageLines({ console: consoleEvents.filter(event => event.source !== 'script'), pageErrors: (files.pageerrors || []).map(event => event.text), network: files.network || [] }));
  for (const warning of (summary.warnings || []).filter(w => !HEALTH_WARNINGS.includes(w.code))) lines.push(`warning: ${clip(errorLines(warning.message)[0] ?? warning.code, 300)}`);
  lines.push(artifactLine(summary.artifacts, summary.omittedArtifacts));
  return `${lines.join('\n')}\n`;
}

module.exports = { renderRun, renderSession, renderStatus, errorLines };
