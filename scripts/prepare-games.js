#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve('public/games');
const textExtensions = new Set(['.html','.htm','.css','.js','.mjs','.json']);
let changedFiles = 0;
let rewrittenReferences = 0;
function walk(dir, gameRoot) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, gameRoot);
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) rewriteFile(full, gameRoot);
  }
}
function resolveGameAsset(gameRoot, sourceFile, reference) {
  if (!reference.startsWith('/') || reference.startsWith('//')) return null;
  const suffixAt = reference.search(/[?#]/);
  const pathname = suffixAt < 0 ? reference : reference.slice(0, suffixAt);
  const suffix = suffixAt < 0 ? '' : reference.slice(suffixAt);
  if (!pathname || pathname === '/') return null;
  let decoded;
  try { decoded = decodeURIComponent(pathname.slice(1)); } catch { decoded = pathname.slice(1); }
  const target = path.resolve(gameRoot, decoded);
  const rel = path.relative(gameRoot, target);
  if (!rel || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
  let relative = path.relative(path.dirname(sourceFile), target).split(path.sep).join('/');
  if (!relative.startsWith('.')) relative = './' + relative;
  return relative + suffix;
}
function rewriteFile(file, gameRoot) {
  let source = fs.readFileSync(file, 'utf8');
  const original = source;
  const rewrite = reference => {
    const replacement = resolveGameAsset(gameRoot, file, reference);
    if (replacement && replacement !== reference) { rewrittenReferences++; return replacement; }
    return reference;
  };
  source = source.replace(/(["'`])(\/[^"'`\s<>]*)\1/g, (whole, quote, reference) => {
    const replacement = rewrite(reference);
    return replacement === reference ? whole : quote + replacement + quote;
  });
  source = source.replace(/url\(\s*(\/[^)'"\s]+)\s*\)/gi, (whole, reference) => {
    const replacement = rewrite(reference);
    return replacement === reference ? whole : 'url(' + replacement + ')';
  });
  if (source !== original) {
    fs.writeFileSync(file, source);
    changedFiles++;
    console.log('Rewrote local asset paths: ' + path.relative(root, file));
  }
}
if (fs.existsSync(root)) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== 'afterglow') walk(path.join(root, entry.name), path.join(root, entry.name));
  }
}
console.log('Prepared ' + rewrittenReferences + ' root-relative local asset references across ' + changedFiles + ' files.');
