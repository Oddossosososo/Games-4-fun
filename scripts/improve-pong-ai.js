#!/usr/bin/env node
'use strict';
const fs=require('fs');
const vm=require('vm');
const file='public/games/jeffreyhamilton6399-arcadia/games/pong/index.html';
if(!fs.existsSync(file)) throw new Error('Pong clone not found: '+file);
let html=fs.readFileSync(file,'utf8');
const old=`    // AI: track ball with capped speed, with slight reaction lag/imperfection
    var target = ball.y - cpu.h/2;
    // Add some imperfection — only react when ball moves toward AI
    if (ball.vx > 0){
      // predict ball y at cpu.x (simple, no wall reflection prediction)
      var dx = cpu.x - ball.x;
      if (dx > 0){
        var t = dx / Math.abs(ball.vx);
        var predicted = ball.y + ball.vy * t;
        // reflect off walls
        while (predicted < 0 || predicted > H){
          if (predicted < 0) predicted = -predicted;
          if (predicted > H) predicted = 2*H - predicted;
        }
        // add small random error to make AI beatable
        target = predicted - cpu.h/2 + (Math.random()*60 - 30);
      }
    } else {
      // drift toward center while waiting
      target = H/2 - cpu.h/2 + (Math.random()*40 - 20);
    }
    var dy = target - cpu.y;
    var step = AI_MAX_SPEED * dt;
    if (Math.abs(dy) <= step) cpu.y = target;
    else cpu.y += Math.sign(dy) * step;
    if (cpu.y < 0) cpu.y = 0;
    if (cpu.y + cpu.h > H) cpu.y = H - cpu.h;`;
const replacement=`    moveGodPaddle(cpu, 1, dt);`;
if(!html.includes(old)) throw new Error('Pong AI block did not match; refusing to patch');

const helperAnchor="  function update(dt){";
const helper=`function predictHotmapTarget() {
  // Forecast the likely landing zones from a spread of possible player contact offsets.
  if (ball.vx >= 0 || Math.abs(ball.vx) < 1e-9) return null;
  const playerFaceX = player.x + player.w + ball.r;
  const framesToPlayer = (playerFaceX - ball.x) / ball.vx / PHYSICS_STEP;
  if (framesToPlayer < 0 || framesToPlayer > 2.05) return null;

  const bins = new Array(32).fill(0);
  const span = H - 2 * ball.r;
  if (span <= 0) return null;
  const nextSpeed = ball.speed + SPEED_INC;
  for (let i = 0; i <= 64; i++) {
    const contactOffset = -1 + (2 * i / 64);
    const angle = contactOffset * (75 * Math.PI / 180);
    let vx = Math.cos(angle) * nextSpeed;
    let vy = Math.sin(angle) * nextSpeed + (player.vy || 0) * 0.30;
    const length = Math.hypot(vx, vy) || 1;
    vx *= nextSpeed / length;
    vy *= nextSpeed / length;
    if (vx <= 1e-9) continue;
    const targetFaceX = cpu.x - ball.r;
    const flight = Math.max(0, (targetFaceX - playerFaceX) / vx);
    const predicted = pongGodWasm && pongGodWasm.predict_intercept_y
      ? pongGodWasm.predict_intercept_y(ball.y, vy, flight, H, ball.r)
      : (function(){
          const raw = ball.y + vy * flight - ball.r;
          const folded = ((raw % (2 * span)) + (2 * span)) % (2 * span);
          return ball.r + (folded <= span ? folded : 2 * span - folded);
        })();
    const bin = Math.max(0, Math.min(bins.length - 1,
      Math.floor((predicted - ball.r) / span * bins.length)));
    bins[bin]++;
  }
  let hottest = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[hottest]) hottest = i;
  return ball.r + (hottest + 0.5) * span / bins.length;
}

function moveGodPaddle(paddle, direction, dt) {
  const previousY = paddle.y;
  let impactY = ball.y;
  if (direction > 0 && ball.vx < 0) {
    const hotmapTarget = predictHotmapTarget();
    if (hotmapTarget !== null) {
      paddle.y = Math.max(0, Math.min(H - paddle.h, hotmapTarget - paddle.h / 2));
      paddle.vy = dt > 0 ? (paddle.y - previousY) / dt : 0;
      paddle._stagedHotmap = true;
      return;
    }
  }
  if (ball.vx * direction > 0 && Math.abs(ball.vx) > 1e-9) {
    const faceX = direction < 0 ? paddle.x + paddle.w + ball.r : paddle.x - ball.r;
    const timeToImpact = Math.max(0, (faceX - ball.x) / ball.vx);
    if (pongGodWasm && pongGodWasm.predict_intercept_y) {
      impactY = pongGodWasm.predict_intercept_y(ball.y, ball.vy, timeToImpact, H, ball.r);
    } else {
      const span = H - 2 * ball.r;
      const raw = ball.y + ball.vy * timeToImpact - ball.r;
      const folded = ((raw % (2 * span)) + (2 * span)) % (2 * span);
      impactY = ball.r + (folded <= span ? folded : 2 * span - folded);
    }
  }
  const edgeAim = Math.sin((rallyHits + 1) * 1.61803398875 + direction * 0.73) * paddle.h * 0.008;
  const targetY = pongGodWasm && pongGodWasm.clamp_paddle_target
    ? pongGodWasm.clamp_paddle_target(impactY, paddle.h, H)
    : Math.max(0, Math.min(H - paddle.h, impactY - paddle.h / 2 + edgeAim));
  paddle.y = Math.max(0, Math.min(H - paddle.h, targetY + edgeAim));
  paddle.vy = dt > 0 ? (paddle.y - previousY) / dt : 0;
  paddle._stagedHotmap = false;
}`;

if(!html.includes(helperAnchor)) throw new Error('Update function anchor missing');
html=html.replace(helperAnchor,helper+helperAnchor);

const playerOld=`    // player paddle (keyboard control if vy set)
    player.y += player.vy * dt;
    if (player.y < 0) player.y = 0;
    if (player.y + player.h > H) player.y = H - player.h;`;
const playerNew=`    // Normal mode uses player input; symmetry mode uses the identical GOD CPU controller.
    if (symmetryMode) moveGodPaddle(player, -1, dt);
    else {
      player.y += player.vy * dt;
      if (player.y < 0) player.y = 0;
      if (player.y + player.h > H) player.y = H - player.h;
    }`;
if(!html.includes(playerOld)) throw new Error('Player movement block missing');
html=html.replace(playerOld,playerNew);

const stateOld="var player, cpu, ball, pscore, cscore, running, started, last, serveTimer, paused;";
if(!html.includes(stateOld)) throw new Error('State declaration missing');
html=html.replace(stateOld,stateOld+"\n  var symmetryMode = false;\n  var rallyHits = 0;");

const uiAnchor="  <div id=\"stage\">";
if(!html.includes(uiAnchor)) throw new Error('Stage anchor missing');
html=html.replace(uiAnchor,'  <div style="display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin-bottom:10px"><button class="btn" id="symmetryToggle" type="button" style="padding:8px 14px;font-size:11px">Mode: Player vs CPU</button><label id="symmetrySpeedWrap" class="hidden" style="display:flex;align-items:center;gap:7px;color:#d8ccff;font-size:10px">START SPEED <input id="symmetryStartSpeed" type="number" min="0.01" step="any" value="390" inputmode="decimal" aria-label="Starting ball speed" style="width:112px;background:#211b3a;color:#fff;border:1px solid #6345a8;border-radius:6px;padding:7px;font:700 11px ui-monospace,monospace"></label></div>\n'+uiAnchor);

const hudAnchor="  var loseCEl = document.getElementById('loseC');";
const hudCode=`  var symmetryToggle = document.getElementById('symmetryToggle');
  var symmetrySpeedWrap = document.getElementById('symmetrySpeedWrap');
  var symmetryStartSpeed = document.getElementById('symmetryStartSpeed');
  var playerLabel = document.querySelector('#hud .you small');
  var cpuLabel = document.querySelector('#hud .cpu small');
  symmetryToggle.addEventListener('click', function(){
    if (started) return;
    symmetryMode = !symmetryMode;
    playerLabel.textContent = symmetryMode ? 'Bot A' : 'You';
    cpuLabel.textContent = symmetryMode ? 'Bot B' : 'CPU';
    symmetryToggle.textContent = symmetryMode ? 'Mode: Perfect Symmetry' : 'Mode: Player vs CPU';
    symmetrySpeedWrap.classList.toggle('hidden', !symmetryMode);
    startO.querySelector('p').textContent = symmetryMode
      ? 'Two identical uncapped GOD CPUs use instant tracking, Rust/WASM prediction and adaptive high-speed physics.'
      : 'Move your left paddle with mouse, touch, or arrow keys. Each rally speeds the ball up. First to 9 points wins the match.';
  });`;
if(!html.includes(hudAnchor)) throw new Error('HUD anchor missing');
html=html.replace(hudAnchor,hudAnchor+"\n\n"+hudCode);

const pointerAnchor="  function pointerToPaddle(clientY){";
if(!html.includes(pointerAnchor)) throw new Error('Pointer handler missing');
html=html.replace(pointerAnchor,pointerAnchor+"\n    if (symmetryMode) return;");
html=html.replace("if (e.key === 'ArrowUp') { player.vy = -480; e.preventDefault(); }","if (e.key === 'ArrowUp' && !symmetryMode) { player.vy = -480; e.preventDefault(); }");
html=html.replace("else if (e.key === 'ArrowDown') { player.vy = 480; e.preventDefault(); }","else if (e.key === 'ArrowDown' && !symmetryMode) { player.vy = 480; e.preventDefault(); }");
html=html.replace("if (e.key === 'ArrowUp' && !keys['ArrowDown']) player.vy = 0;","if (!symmetryMode && e.key === 'ArrowUp' && !keys['ArrowDown']) player.vy = 0;");
html=html.replace("if (e.key === 'ArrowDown' && !keys['ArrowUp']) player.vy = 0;","if (!symmetryMode && e.key === 'ArrowDown' && !keys['ArrowUp']) player.vy = 0;");
html=html.replace("if (keys['ArrowUp']) player.vy = -480;","if (!symmetryMode && keys['ArrowUp']) player.vy = -480;");
html=html.replace("if (keys['ArrowDown']) player.vy = 480;","if (!symmetryMode && keys['ArrowDown']) player.vy = 480;");

html=html.replace(old,replacement);
html=html.replace('function startGame(){\n reset();started=true;','function startGame(){\n var requestedSpeed = Number(symmetryStartSpeed.value);\n BASE_SPEED = Number.isFinite(requestedSpeed) && requestedSpeed > 0 ? requestedSpeed : 390;\n reset();started=true;');
html=html.replace('pscore = 0; cscore = 0;','pscore = 0; cscore = 0;\n    rallyHits = 0;');
html=html.replace('function bouncePaddle(p, hit){','function bouncePaddle(p, hit){\n    rallyHits++;');
html=html.replace('var angle = hit * (Math.PI/3);',
  'var ANGLE_COUNT = 1e+307;\n    var normalizedOffset = Math.max(-1, Math.min(1, hit));\n    var quantizedOffset = Math.round(((normalizedOffset + 1) / 2) * (ANGLE_COUNT - 1)) / (ANGLE_COUNT - 1) * 2 - 1;\n    var bounceAngle = quantizedOffset * (75 * Math.PI / 180);\n    var angle = bounceAngle;');
html=html.replace('ball.speed = Math.min(MAX_SPEED, ball.speed + SPEED_INC);',
  'ball.speed = Math.min(Number.MAX_VALUE / 4, ball.speed + SPEED_INC);');
html=html.replace('ball.vy = Math.sin(angle) * ball.speed;',
  'var spinImpulse = (p.vy || 0) * 0.30;\n    ball.vy = Math.sin(angle) * ball.speed + spinImpulse;\n    var velocityLength = Math.hypot(ball.vx, ball.vy) || 1;\n    ball.vx *= ball.speed / velocityLength;\n    ball.vy *= ball.speed / velocityLength;
    // Exact hit-frame lock: replace the speculative hotmap with the actual outgoing trajectory.
    moveGodPaddle(cpu, 1, 0);');
const hitPatch = `    if (p === player) ball.x = p.x + p.w + ball.r + 0.5;
    else ball.x = p.x - ball.r - 0.5;`;
const hitReplacement = `    if (p === player) {
      ball.x = p.x + p.w + ball.r + 0.5;
      cpu._pretarget = true;
    } else {
      ball.x = p.x - ball.r - 0.5;
    }`;
if (!html.includes(hitPatch)) throw new Error('Pong hit handler did not match');
html=html.replace(hitPatch,hitReplacement);
const oldLoop = `  function loop(now){
    if (!started) return;
    var dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }`;
const newLoop = `  // 240 Hz physics simulation; rendering remains display-refresh paced.
  var physicsAccumulator = 0;
  var PHYSICS_STEP = 1 / 240;
  function loop(now){
    if (!started) return;
    var frameDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    physicsAccumulator = Math.min(physicsAccumulator + frameDt, 0.1);
    var steps = 0;
    while (physicsAccumulator > 0 && steps < 2048) {
      // Shrink the physics step as the ball accelerates so it cannot tunnel through paddles.
      var speedNow = Math.max(1, Math.abs(ball.vx), Math.abs(ball.vy));
      var adaptiveStep = Math.min(PHYSICS_STEP, 1.5 / speedNow, physicsAccumulator);
      update(adaptiveStep);
      physicsAccumulator -= adaptiveStep;
      steps++;
    }
    draw();
    requestAnimationFrame(loop);
  }`;
if (!html.includes(oldLoop)) throw new Error('Pong frame loop did not match');
html=html.replace(oldLoop,newLoop);
html=html.replace('var MAX_SPEED = 820;','var MAX_SPEED = Infinity;');
html=html.replace('var SPEED_INC = 28;','var SPEED_INC = 45;');
html=html.replace('var AI_MAX_SPEED = 360;','var AI_MAX_SPEED = Infinity;\n  var pongGodWasm = null;\n  fetch("./pong-ai.wasm").then(function(r){ if(!r.ok) throw new Error("WASM unavailable"); return r.arrayBuffer(); }).then(function(bytes){ return WebAssembly.instantiate(bytes); }).then(function(result){ pongGodWasm = result.instance.exports; }).catch(function(){ console.warn("Pong GOD CPU: using JavaScript fallback."); });');
const scriptStart=html.lastIndexOf('<script>');
const scriptEnd=html.indexOf('</script>',scriptStart);
if(scriptStart<0||scriptEnd<0) throw new Error('Pong script tag missing after patch');
new vm.Script(html.slice(scriptStart+8,scriptEnd),{filename:'patched-pong.js'});
fs.writeFileSync(file,html);
console.log('Pong GOD CPU patched: symmetric prediction, minimax shot selection, impact staging, spin, 240 Hz physics and WASM raycasting.');
