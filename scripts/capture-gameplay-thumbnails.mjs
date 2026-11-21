import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const publicDir = path.join(root, "public");
const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, "games.json"), "utf8"));
const routes = JSON.parse(fs.readFileSync(path.join(publicDir, "GAME-SOURCES.json"), "utf8"));
const output = "/tmp/afterglow-gameplay-frames";
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const server = await import("node:http");
const mime = new Map([
  [".html", "text/html"], [".js", "text/javascript"], [".css", "text/css"],
  [".json", "application/json"], [".png", "image/png"], [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"], [".gif", "image/gif"], [".svg", "image/svg+xml"],
  [".webp", "image/webp"], [".mp3", "audio/mpeg"], [".ogg", "audio/ogg"],
  [".woff", "font/woff"], [".woff2", "font/woff2"]
]);
const httpServer = server.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { res.writeHead(400).end(); return; }
  const target = path.resolve(publicDir, "." + pathname);
  if (!target.startsWith(publicDir + path.sep) && target !== publicDir) { res.writeHead(403).end(); return; }
  fs.stat(target, (err, stat) => {
    const file = err ? path.join(target, "index.html") : (stat.isDirectory() ? path.join(target, "index.html") : target);
    fs.readFile(file, (readErr, data) => {
      if (readErr) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "Content-Type": mime.get(path.extname(file).toLowerCase()) || "application/octet-stream" });
      res.end(data);
    });
  });
});
await new Promise(resolve => httpServer.listen(4173, "127.0.0.1", resolve));

const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({
  viewport: { width: 640, height: 360 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce"
});
const keys = ["ArrowUp", "ArrowRight", "Space", "Enter", "ArrowDown", "ArrowLeft", "Space", "ArrowUp", "ArrowRight", "Space"];
let captured = 0;

for (const game of manifest.games) {
  const local = routes[game.id];
  if (!local) {
    console.log("Skipping external-only game thumbnail:", game.title);
    continue;
  }
  const target = new URL(local.replace(/^\.\//, "/"), "http://127.0.0.1:4173").href;

  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const framesDir = path.join(output, game.id);
  fs.mkdirSync(framesDir, { recursive: true });
  try {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 35000 });
    await page.waitForTimeout(2200);
    await page.mouse.click(320, 180).catch(() => {});
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(350);
    for (let i = 0; i < keys.length; i++) {
      await page.keyboard.press(keys[i]).catch(() => {});
      await page.waitForTimeout(330);
      await page.screenshot({ path: path.join(framesDir, String(i).padStart(2, "0") + ".png"), animations: "allow" });
    }
    captured++;
    console.log("Captured gameplay:", game.title);
  } catch (error) {
    console.warn("Gameplay capture failed for " + game.title + ": " + error.message);
    fs.rmSync(framesDir, { recursive: true, force: true });
  } finally {
    await page.close();
  }
}

await browser.close();
await new Promise(resolve => httpServer.close(resolve));
console.log("Captured real gameplay for " + captured + " of " + Object.keys(routes).length + " locally hosted games. External games use their catalogue artwork fallback.");
