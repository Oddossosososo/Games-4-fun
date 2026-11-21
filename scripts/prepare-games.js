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

const preloadScript = String.raw`(function () {
  if (window.__afterglowAssetQueueInstalled) return;
  window.__afterglowAssetQueueInstalled = true;
  var maxConcurrent = 4, queue = [], active = 0, seen = new Set();
  function enqueue(url, priority) {
    try {
      var parsed = new URL(url, document.baseURI);
      if (parsed.origin !== location.origin || !/^https?:$/.test(parsed.protocol)) return;
      parsed.hash = '';
      var key = parsed.href;
      if (seen.has(key) || key === location.href) return;
      seen.add(key);
      queue.push({ url: key, priority: priority || 0 });
      queue.sort(function (a, b) { return b.priority - a.priority; });
      pump();
    } catch (_) {}
  }
  function pump() {
    while (active < maxConcurrent && queue.length) {
      var item = queue.shift();
      active++;
      fetch(item.url, { cache: 'force-cache', credentials: 'same-origin' })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.arrayBuffer();
        })
        .catch(function () {})
        .finally(function () { active--; pump(); });
    }
  }
  function scanCss(url, depth) {
    if (depth > 2) return;
    fetch(url, { cache: 'force-cache', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (css) {
        var match, re = /url\\(\\s*(['"]?)(.*?)\\1\\s*\\)|@import\\s+(['"])(.*?)\\3/gi;
        while ((match = re.exec(css))) {
          var asset = match[2] || match[4];
          if (!asset || /^(data:|blob:|#)/i.test(asset)) continue;
          var resolved = new URL(asset, url).href;
          enqueue(resolved, 2);
          if (/\\.css(?:[?#]|$)/i.test(resolved)) scanCss(resolved, depth + 1);
        }
      }).catch(function () {});
  }
  function discover() {
    document.querySelectorAll('img[src],audio[src],video[poster],source[src],input[type="image"][src]').forEach(function (el) {
      enqueue(el.currentSrc || el.src || el.poster, 4);
    });
    document.querySelectorAll('link[rel~="stylesheet"][href]').forEach(function (el) {
      var href = el.href;
      enqueue(href, 3);
      scanCss(href, 0);
    });
    document.querySelectorAll('video[src]').forEach(function (el) { enqueue(el.src, 0); });
    if (window.performance && performance.getEntriesByType) {
      performance.getEntriesByType('resource').forEach(function (entry) {
        if (/\\.(?:png|jpe?g|webp|gif|svg|woff2?|ttf|otf|ogg|mp3|mp4|webm|obj|mtl|gltf|glb|bin)(?:[?#]|$)/i.test(entry.name)) enqueue(entry.name, 1);
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', discover, { once: true });
  else discover();
  window.addEventListener('load', discover, { once: true });
})();`;

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

const manifest = JSON.parse(fs.readFileSync(path.resolve('games.json'), 'utf8'));
let injected = 0;
for (const game of manifest.games.filter(g => g.verified && g.mode === 'local')) {
  const repo = game.source.match(/github\.com\/([^/]+\/[^/]+)/i)?.[1];
  if (!repo || !game.entrypoint) continue;
  const folder = repo.toLowerCase().replaceAll('/', '-');
  const target = path.resolve(root, folder, game.entrypoint);
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) continue;
  let html = fs.readFileSync(target, 'utf8');
  if (html.includes('__afterglowAssetQueueInstalled')) continue;
  const tag = '<script>' + preloadScript.replaceAll('\\\\', '\\') + '</script>';
  if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, tag + '</head>');
  else html = tag + html;
  fs.writeFileSync(target, html);
  injected++;
  console.log('Installed shared asset queue: ' + game.id);
}
console.log('Installed shared preloader in ' + injected + ' game entrypoints.');
