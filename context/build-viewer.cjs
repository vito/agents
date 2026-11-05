#!/usr/bin/env node
'use strict';
// No Dagger, bundler, npm install, or network needed. The portable export and
// this versioned hosted viewer deliberately ship byte-identical source assets.
const fs = require('node:fs');
const path = require('node:path');
const output = process.argv[2];
if (!output || process.argv.length !== 3) {
  console.error('Usage: node context/build-viewer.cjs <output-directory>');
  process.exit(1);
}
fs.mkdirSync(output, {recursive: true});
for (const file of ['context.css', 'render.js', 'interactions.js', 'boot.js']) {
  fs.copyFileSync(path.join(__dirname, file), path.join(output, file));
}
fs.copyFileSync(path.join(__dirname, 'viewer.html'), path.join(output, 'index.html'));
console.log('Built Context viewer at ' + output);
