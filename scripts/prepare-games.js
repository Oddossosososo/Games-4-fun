#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve('public/games');
const fixes = [{
  folder: 'wwwtyro-astray',
  file: 'index.html',
  replacements: [
    [/loadTexture\(['"]\/ball\.png['"]\)/g, "loadTexture('./ball.png')"],
    [/loadTexture\(['"]\/concrete\.png['"]\)/g, "loadTexture('./concrete.png')"],
    [/loadTexture\(['"]\/brick\.png['"]\)/g, "loadTexture('./brick.png')"]
  ]
}];

for (const fix of fixes) {
  const target = path.join(root, fix.folder, fix.file);
  if (!fs.existsSync(target)) {
    console.warn('Skipping optional path fix; entrypoint not present: ' + target);
    continue;
  }
  let html = fs.readFileSync(target, 'utf8');
  for (const [pattern, replacement] of fix.replacements) html = html.replace(pattern, replacement);
  fs.writeFileSync(target, html);
  console.log('Prepared GitHub Pages asset paths: ' + fix.folder + '/' + fix.file);
}
