'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve('public');
const routes = JSON.parse(fs.readFileSync(path.join(root, 'GAME-SOURCES.json'), 'utf8'));
const games = JSON.parse(fs.readFileSync('games.json', 'utf8')).games;
const output = path.join(root, 'thumbs');
const origin = 'http://127.0.0.1:4173';
const mime = {
  '.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp',
  '.svg':'image/svg+xml','.wasm':'application/wasm','.mp3':'audio/mpeg',
  '.ogg':'audio/ogg','.wav':'audio/wav','.woff':'font/woff','.woff2':'font/woff2'
};

function startServer() {
  return http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, origin).pathname); }
    catch { res.writeHead(400).end(); return; }
    const file = path.resolve(root, '.' + pathname);
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      res.writeHead(403).end(); return;
    }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      res.writeHead(200, {
        'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    });
  }).listen(4173, '127.0.0.1');
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const server = startServer();
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({
      viewport: { width: 960, height: 540 },
      deviceScaleFactor: 1
    });
    page.setDefaultNavigationTimeout(20000);
    let made = 0;
    for (const game of games) {
      const route = routes[game.id];
      // Leave the aim-training title on its neutral icon card.
      if (!route || game.id === 'aim-trainer' || game.repositoryViewer) continue;
      const target = new URL(route, origin + '/').href;
      try {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2500);
        await page.screenshot({
          path: path.join(output, game.id + '.webp'),
          type: 'webp',
          quality: 78,
          animations: 'disabled'
        });
        made++;
        console.log('Captured gameplay thumbnail: ' + game.id);
      } catch (error) {
        console.warn('Thumbnail skipped for ' + game.id + ': ' + error.message);
      }
    }
    console.log('Generated ' + made + ' gameplay thumbnails.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.warn('Gameplay thumbnail generation unavailable: ' + error.message);
  process.exit(0);
});
