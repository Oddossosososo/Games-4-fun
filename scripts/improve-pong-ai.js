#!/usr/bin/env node
'use strict';
const fs=require('fs');
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
const helper="function predictReflectedY(y, vy, time) {\n  if (pongGodWasm && pongGodWasm.predict_intercept_y) {\n    return pongGodWasm.predict_intercept_y(y, vy, time, H, ball.r || 0);\n  }\n  const radius = ball.r || 0;\n  const span = Math.max(1, H - 2 * radius);\n  const period = span * 2;\n  const raw = y + vy * Math.max(0, time) - radius;\n  const folded = ((raw % period) + period) % period;\n  return radius + (folded <= span ? folded : period - folded);\n}\n\nfunction moveGodPaddle(paddle, direction, dt) {\n  const opponent = direction > 0 ? player : cpu;\n  const toward = direction > 0 ? ball.vx > 0 : ball.vx < 0;\n  const radius = ball.r || 0;\n  let targetY = H / 2 - paddle.h / 2;\n\n  if (toward && Math.abs(ball.vx) > 1e-9) {\n    const edgeX = direction > 0 ? paddle.x : paddle.x + paddle.w;\n    const dx = Math.max(0, direction > 0 ? edgeX - ball.x : ball.x - edgeX);\n    const timeToImpact = dx / Math.abs(ball.vx);\n    const interceptY = predictReflectedY(ball.y, ball.vy, timeToImpact);\n    const opponentSpeed = Number.isFinite(opponent.maxSpeed) ? opponent.maxSpeed :\n      (Number.isFinite(opponent.speed) ? opponent.speed : (opponent === cpu ? AI_MAX_SPEED : 480));\n    const candidates = [-0.48, -0.36, -0.24, -0.12, 0, 0.12, 0.24, 0.36, 0.48];\n    const opponentEdge = direction > 0 ? opponent.x + opponent.w : opponent.x;\n    const horizontalReturn = Math.abs(opponentEdge - edgeX);\n    const speed = Math.max(1, Number.isFinite(ball.speed) ? ball.speed : Math.hypot(ball.vx, ball.vy));\n    let bestOffset = 0;\n    let bestScore = -Infinity;\n\n    for (const hitOffset of candidates) {\n      const angle = hitOffset * (Math.PI / 3);\n      const shotVx = Math.max(1e-6, Math.abs(Math.cos(angle) * speed));\n      const shotVy = Math.sin(angle) * speed;\n      const returnTime = horizontalReturn / shotVx;\n      const totalOpponentTime = timeToImpact + returnTime;\n      const landingY = predictReflectedY(interceptY, shotVy, returnTime);\n      const minCenter = radius + opponent.h / 2;\n      const maxCenter = H - radius - opponent.h / 2;\n      const rawOpponentCenter = opponent.y + opponent.h / 2 + (opponent.vy || 0) * totalOpponentTime;\n      const opponentCenter = Math.max(minCenter, Math.min(maxCenter, rawOpponentCenter));\n      const reachable = opponent.h / 2 + Math.max(0, opponentSpeed) * totalOpponentTime;\n      const miss = Math.max(0, Math.abs(landingY - opponentCenter) - reachable);\n      const score = miss + Math.abs(hitOffset) * 0.0001;\n      if (score > bestScore) { bestScore = score; bestOffset = hitOffset; }\n    }\n\n    // Actual bounce physics uses hitOffset * 60 degrees, so position the paddle\n    // center to create that exact contact offset (not the inverse).\n    const desiredCenter = interceptY - bestOffset * (paddle.h / 2);\n    const desiredTop = Math.max(0, Math.min(H - paddle.h, desiredCenter - paddle.h / 2));\n    const framesToImpact = timeToImpact / Math.max(dt, 1 / 240);\n    const staging = framesToImpact > 2 ? Math.sign(desiredTop - paddle.y) * 12 : 0;\n    targetY = desiredTop - staging;\n  } else {\n    // Reset to the midpoint between the opponent's extreme reachable return lanes.\n    const minY = radius + opponent.h / 2;\n    const maxY = H - radius - opponent.h / 2;\n    const midpoint = (minY + maxY) / 2;\n    const timeToOpponent = Math.abs(ball.x - opponent.x) / Math.max(1, Math.abs(ball.vx));\n    const predicted = Math.max(minY, Math.min(maxY, opponent.y + opponent.h / 2 + (opponent.vy || 0) * timeToOpponent));\n    targetY = (midpoint + predicted) / 2 - paddle.h / 2;\n  }\n\n  targetY = Math.max(0, Math.min(H - paddle.h, targetY));\n  const previousY = paddle.y;\n  const maxSpeed = Number.isFinite(paddle.maxSpeed) ? paddle.maxSpeed : AI_MAX_SPEED;\n  const step = Number.isFinite(maxSpeed) ? Math.max(0, maxSpeed * dt) : Infinity;\n  const delta = targetY - paddle.y;\n  paddle.y = Math.abs(delta) <= step ? targetY : paddle.y + Math.sign(delta) * step;\n  paddle.y = Math.max(0, Math.min(H - paddle.h, paddle.y));\n  paddle.vy = dt > 0 ? Math.max(-2400, Math.min(2400, (paddle.y - previousY) / dt)) : 0;\n}";

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
html=html.replace(uiAnchor,'  <button class="btn" id="symmetryToggle" type="button" style="margin:0 0 10px;padding:8px 14px;font-size:11px">Mode: Player vs CPU</button>\n'+uiAnchor);

const hudAnchor="  var loseCEl = document.getElementById('loseC');";
const hudCode=`  var symmetryToggle = document.getElementById('symmetryToggle');
  var playerLabel = document.querySelector('#hud .you small');
  var cpuLabel = document.querySelector('#hud .cpu small');
  symmetryToggle.addEventListener('click', function(){
    if (started) return;
    symmetryMode = !symmetryMode;
    playerLabel.textContent = symmetryMode ? 'Bot A' : 'You';
    cpuLabel.textContent = symmetryMode ? 'Bot B' : 'CPU';
    symmetryToggle.textContent = symmetryMode ? 'Mode: Perfect Symmetry' : 'Mode: Player vs CPU';
    startO.querySelector('p').textContent = symmetryMode
      ? 'Two identical uncapped GOD CPUs use instant tracking, Rust/WASM prediction and adaptive high-speed physics.'
      : 'Move your left paddle with mouse, touch, or arrow keys. Each rally speeds the ball up. First to 7 points wins the match.';
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
html=html.replace('pscore = 0; cscore = 0;','pscore = 0; cscore = 0;\n    rallyHits = 0;');
html=html.replace('function bouncePaddle(p, hit){','function bouncePaddle(p, hit){\n    rallyHits++;');
html=html.replace('ball.vy = Math.sin(angle) * ball.speed;',
  'var spinImpulse = Math.max(-520, Math.min(520, (p.vy || 0) * 0.30));\n    ball.vy = Math.sin(angle) * ball.speed + spinImpulse;\n    var velocityLength = Math.hypot(ball.vx, ball.vy) || 1;\n    ball.vx *= ball.speed / velocityLength;\n    ball.vy *= ball.speed / velocityLength;');
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
      var adaptiveStep = Math.min(PHYSICS_STEP, Math.max(1 / 20000, 1.5 / speedNow), physicsAccumulator);
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
fs.writeFileSync(file,html);
console.log('Pong GOD CPU patched: symmetric prediction, minimax shot selection, impact staging, spin, 240 Hz physics and WASM raycasting.');
