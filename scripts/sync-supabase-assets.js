#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const projectUrl = 'https://zvtrluxlzrihsuvralhg.supabase.co';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  console.log('SUPABASE_SERVICE_ROLE_KEY is not configured; leaving game assets on GitHub Pages.');
  process.exit(0);
}
const manifest = JSON.parse(fs.readFileSync('games.json','utf8'));
const publicRoot = path.resolve('public');
const bucket = 'arcade-games';

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8',
    '.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8',
    '.mjs':'application/javascript; charset=utf-8','.json':'application/json',
    '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp',
    '.gif':'image/gif','.svg':'image/svg+xml','.mp3':'audio/mpeg','.ogg':'audio/ogg',
    '.wav':'audio/wav','.mp4':'video/mp4','.webm':'video/webm','.wasm':'application/wasm',
    '.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf'
  })[ext] || 'application/octet-stream';
}
function filesBelow(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if (['.git','node_modules'].includes(entry.name)) continue;
    const full = path.join(dir,entry.name);
    if (entry.isDirectory()) out.push(...filesBelow(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
async function request(url, options={}) {
  const response = await fetch(url,{
    ...options,
    headers:{
      apikey:serviceKey,
      Authorization:'Bearer '+serviceKey,
      ...(options.headers||{})
    }
  });
  if (!response.ok) throw new Error(response.status+' '+response.statusText+' for '+url+': '+(await response.text()).slice(0,500));
  return response;
}
async function main() {
  let uploaded = 0;
  for (const game of manifest.games) {
    if (!game.verified || !['local','bundled'].includes(game.mode) || !game.entrypoint) continue;
    let gameDir;
    let entryFile;
    if (game.mode === 'local') {
      const repo = game.source?.match(/github\.com\/([^/]+\/[^/]+)/i)?.[1];
      if (!repo) throw new Error('Missing source repository for '+game.id);
      const slug = repo.toLowerCase().replaceAll('/','-');
      gameDir = path.resolve(publicRoot,'games',slug);
      entryFile = path.resolve(gameDir,game.entrypoint);
    } else {
      entryFile = path.resolve(publicRoot,game.entrypoint);
      gameDir = path.dirname(entryFile);
    }
    const relEntry = path.relative(gameDir,entryFile);
    if (!fs.existsSync(entryFile) || !relEntry || relEntry.startsWith('..') || path.isAbsolute(relEntry)) {
      throw new Error('Cannot find safe entrypoint for '+game.id+': '+entryFile);
    }
    const allFiles = filesBelow(gameDir);
    const assets = [];
    for (const full of allFiles) {
      const relative = path.relative(gameDir,full).split(path.sep).join('/');
      const storagePath = game.id+'/'+relative;
      const encoded = storagePath.split('/').map(encodeURIComponent).join('/');
      const type = mime(full);
      await request(projectUrl+'/storage/v1/object/'+bucket+'/'+encoded,{
        method:'POST',
        headers:{'Content-Type':type,'Cache-Control':'public, max-age=3600','x-upsert':'true'},
        body:fs.readFileSync(full)
      });
      const url = projectUrl+'/storage/v1/object/public/'+bucket+'/'+encoded;
      assets.push({path:relative,storagePath,url,contentType:type,bytes:fs.statSync(full).size,kind:relative===relEntry?'entrypoint':'asset'});
      uploaded++;
    }
    const entry = assets.find(asset=>asset.path===relEntry);
    if (!entry) throw new Error('Entrypoint was not uploaded for '+game.id);
    await request(projectUrl+'/rest/v1/game_catalog?id=eq.'+encodeURIComponent(game.id),{
      method:'PATCH',
      headers:{'Content-Type':'application/json','Prefer':'return=minimal'},
      body:JSON.stringify({assets,entrypoint_url:entry.url,updated_at:new Date().toISOString()})
    });
    console.log('Uploaded '+assets.length+' files for '+game.id+'; entrypoint '+entry.url);
  }
  console.log('Supabase Storage sync complete: '+uploaded+' game files uploaded.');
}
main().catch(error=>{console.error(error);process.exit(1);});
