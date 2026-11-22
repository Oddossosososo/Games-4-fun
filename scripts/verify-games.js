#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const manifestPath = path.resolve('games.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.games)) {
  throw new Error('games.json must contain version: 1 and a games array.');
}
const ids = new Set();
const errors = [];
const warnings = [];
const publicRoot = path.resolve('public');
const mapPath = path.join(publicRoot, 'GAME-SOURCES.json');
const sourceMap = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : {};
const MAX_GAME_BYTES = 120 * 1024 * 1024;
const MAX_TOTAL_BYTES = 450 * 1024 * 1024;
const approvedLicenses = new Set([
  'MIT','Apache-2.0','GPL-2.0','GPL-2.0-only','GPL-2.0-or-later',
  'GPL-3.0','GPL-3.0-only','GPL-3.0-or-later','AGPL-3.0',
  'AGPL-3.0-only','AGPL-3.0-or-later','MPL-2.0','Unlicense',
  'BSD-2-Clause','BSD-3-Clause','ISC'
]);
function inside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
}
function folderSize(dir) {
  let total = 0;
  for (const item of fs.readdirSync(dir, {withFileTypes:true})) {
    if (item.name === '.git' || item.name === 'node_modules') continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) total += folderSize(full);
    else if (item.isFile()) total += fs.statSync(full).size;
  }
  return total;
}
for (const game of manifest.games) {
  if (!game || typeof game.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(game.id)) {
    errors.push('Every game needs a valid lowercase kebab-case id.');
    continue;
  }
  if (ids.has(game.id)) errors.push('Duplicate game id: ' + game.id);
  ids.add(game.id);
  for (const field of ['title','category','creator','license','mode']) {
    if (typeof game[field] !== 'string' || !game[field].trim()) errors.push('['+game.id+'] missing '+field);
  }
  if (typeof game.verified !== 'boolean' || typeof game.embeddable !== 'boolean') {
    errors.push('['+game.id+'] verified and embeddable must be booleans');
  }
  if (!game.verified) {
    if (sourceMap[game.id]) errors.push('['+game.id+'] unverified games must not be published in GAME-SOURCES.json');
    warnings.push('Skipping unverified game: '+game.id);
    continue;
  }
  if (game.mode === 'local' || game.mode === 'bundled') {
    if (!game.entrypoint || path.isAbsolute(game.entrypoint) || game.entrypoint.split(/[\\/]/).includes('..')) errors.push('['+game.id+'] unsafe or missing entrypoint');
    let rel = '';
    let folder = '';
    if (game.mode === 'local') {
      if (!game.source || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(game.source)) errors.push('['+game.id+'] local game needs a GitHub source URL');
      if (!approvedLicenses.has(game.license)) errors.push('['+game.id+'] licence is not on the approved list: '+game.license);
      const sourceRepo = game.source?.match(/github\.com\/([^/]+\/[^/]+)/i)?.[1];
      folder = sourceRepo?.toLowerCase().replaceAll('/','-');
      rel = folder && game.entrypoint ? path.posix.join('games',folder,game.entrypoint) : '';
    } else {
      if (!game.source || !game.source.startsWith('https://github.com/')) errors.push('['+game.id+'] bundled game needs its repository source URL');
      rel = game.entrypoint;
    }
    const file = rel ? path.resolve(publicRoot,rel) : '';
    if (!file || !inside(publicRoot,file) || !fs.existsSync(file) || !fs.statSync(file).isFile() || !file.toLowerCase().endsWith('.html')) {
      errors.push('['+game.id+'] deployed entrypoint missing: '+rel);
    }
    if (game.id === 'astray' && fs.existsSync(file)) {
      const html = fs.readFileSync(file, 'utf8');
      if (/loadTexture\(['"]\/(?:ball|concrete|brick)\.png['"]\)/.test(html)) {
        errors.push('[astray] root-relative texture paths break under GitHub Pages project URLs');
      }
      for (const asset of ['ball.png','concrete.png','brick.png']) {
        if (!fs.existsSync(path.join(path.dirname(file),asset))) errors.push('[astray] required texture missing: '+asset);
      }
    }
    const mapped = sourceMap[game.id];
    if (!mapped || mapped !== './'+rel) errors.push('['+game.id+'] GAME-SOURCES.json mapping does not match manifest');
    const gameDir = game.mode === 'local' ? (folder && path.join(publicRoot,'games',folder)) : path.dirname(file);
    if (gameDir && fs.existsSync(gameDir)) {
      const bytes = folderSize(gameDir);
      if (bytes > MAX_GAME_BYTES) errors.push('['+game.id+'] repository payload exceeds 120 MiB ('+(bytes/1024/1024).toFixed(1)+' MiB)');
    }
  } else if (game.mode === 'hosted') {
    errors.push('['+game.id+'] hosted embeds are disabled; use a licensed local/bundled copy or an external link');
  } else if (game.mode === 'external') {
    if (game.embeddable !== false) errors.push('['+game.id+'] external games must not be embedded');
    if (!game.officialUrl || !/^https:\/\//.test(game.officialUrl)) errors.push('['+game.id+'] external game needs an HTTPS officialUrl');
  } else if (game.mode !== 'unavailable') {
    errors.push('['+game.id+'] unsupported mode: '+game.mode);
  }
}
const gamesDir = path.join(publicRoot,'games');
const total = fs.existsSync(gamesDir) ? folderSize(gamesDir) : 0;
if (total > MAX_TOTAL_BYTES) errors.push('All game payloads exceed 450 MiB ('+(total/1024/1024).toFixed(1)+' MiB)');
for (const warning of warnings) console.warn('⚠ '+warning);
console.log('Game manifest: '+manifest.games.length+' entries; '+Object.keys(sourceMap).length+' local builds; payload '+(total/1024/1024).toFixed(1)+' MiB.');
if (errors.length) {
  for (const error of errors) console.error('✖ '+error);
  process.exit(1);
}
console.log('✓ All verified games passed deployment checks.');
