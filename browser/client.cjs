'use strict';

// Runs in a short-lived client container, never in the browser page. Copying
// evidence here decouples retained observations from the live service lifetime.
const fs = require('node:fs/promises');
const path = require('node:path');
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const safeRelative = name => typeof name === 'string' && name.length > 0 && name.length <= 1024 && !name.includes('\\') && !name.includes('\0') && !path.posix.isAbsolute(name) && name.split('/').every(part => part !== '' && part !== '.' && part !== '..');

async function regularFile(root, name) {
  if (!safeRelative(name)) throw new Error('Invalid file path');
  let current = root;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Symlinks are not allowed');
  }
  if (!(await fs.stat(current)).isFile()) throw new Error('Not a regular file');
  return current;
}

async function packageSource(root) {
  const files = [];
  let bytes = 0;
  // Symlinks are rejected rather than silently changing the synchronized tree.
  async function walk(prefix = '') {
    for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
      const name = path.posix.join(prefix, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Sync does not accept symlinks: ${name}`);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) {
        const file = await regularFile(root, name);
        const size = (await fs.stat(file)).size;
        bytes += size;
        if (bytes > MAX_SOURCE_BYTES || files.length >= 10000) throw new Error('Sync source exceeds 64 MiB or 10000 files');
        files.push({ path: name, data: (await fs.readFile(file)).toString('base64') });
      } else throw new Error(`Sync requires regular files: ${name}`);
    }
  }
  await walk();
  return files;
}

async function client(command, { endpoint = process.env.BROWSER_ENDPOINT, token = process.env.BROWSER_TOKEN, instance = process.env.BROWSER_INSTANCE, source = '/sync-source', artifacts = '/artifacts', summaryPath = '/summary.json', statePath = '/state.json' } = {}) {
  if (!endpoint || !token) throw new Error('BROWSER_ENDPOINT and BROWSER_TOKEN are required');
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid browser control endpoint');
  const request = async (pathname, options = {}, timeoutMs = 30000) => {
    let response;
    try {
      response = await fetch(new URL(pathname, url), { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) { throw new Error(`Browser control transport failed at ${url.origin}: ${error.message}`, { cause: error }); }
    if (!response.ok) throw new Error(`Browser control rejected request (${response.status}): ${(await response.text()).slice(0, 8000)}`);
    return response;
  };
  command = { ...command, ...(instance ? { expectedInstance: instance } : {}) };
  if (command.op === 'sync') command.files = await packageSource(source);
  // Queueing is bounded server-side. Transport timeout is deliberately longer
  // than the worker deadline so the invalidation observation can be retrieved.
  const response = await request('/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) }, Math.min(650000, (command.timeoutMs || 30000) + 45000));
  const envelope = await response.json();
  if (!envelope.summary || typeof envelope.summary.instanceID !== 'string' || !envelope.summary.instanceID || !Array.isArray(envelope.artifacts)) throw new Error('Malformed browser control response');
  if (instance && envelope.summary.instanceID !== instance) throw new Error('Session instance changed; refusing restarted service results');
  await fs.mkdir(artifacts, { recursive: true });
  // Fresh client containers normally start empty; refuse to overwrite retained
  // evidence if a caller accidentally reuses an output directory.
  if ((await fs.readdir(artifacts)).length) throw new Error('Artifact output directory must be empty');
  for (const name of envelope.artifacts) {
    if (!safeRelative(name)) throw new Error('Invalid artifact path from browser control');
    // Pin every fetch, not just the command: the service can restart between
    // its result response and materialization of the retained artifact bytes.
    const response = await request(`/artifact?id=${encodeURIComponent(envelope.observation)}&path=${encodeURIComponent(name)}&expectedInstance=${encodeURIComponent(envelope.summary.instanceID)}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const target = path.join(artifacts, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes, { flag: 'wx' });
  }
  await fs.writeFile(summaryPath, JSON.stringify(envelope, null, 2));
  await fs.writeFile(statePath, JSON.stringify(envelope.summary));
  return envelope;
}

async function main() {
  const command = JSON.parse(await fs.readFile(process.argv[2] || '/command.json', 'utf8'));
  const envelope = await client(command);
  process.stdout.write(`${JSON.stringify(envelope.summary)}\n`);
}
module.exports = { client, packageSource };
if (require.main === module) main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
