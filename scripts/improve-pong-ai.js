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
const helper=`  // Shared controller: both paddles use precisely the same GOD CPU logic.
  function moveGodPaddle(paddle, direction, dt){
    var targetY = H/2 - paddle.h/2;
    var movingToward = direction > 0 ? ball.vx > 0 : ball.vx < 0;
    if (movingToward) {
      var edgeX = direction > 0 ? paddle.x : paddle.x + paddle.w;
      var travel = Math.max(0, (direction > 0 ? edgeX - ball.x : ball.x - edgeX) / Math.max(1, Math.abs(ball.vx)));
      var intercept;
      if (pongGodWasm) {
        intercept = pongGodWasm.predict_intercept_y(ball.y, ball.vy, travel, H, ball.r);
        targetY = pongGodWasm.clamp_paddle_target(intercept, paddle.h, H);
      } else {
        var span = H - 2*ball.r;
        var folded = ((ball.y + ball.vy*travel - ball.r) % (2*span) + 2*span) % (2*span);
        intercept = ball.r + (folded <= span ? folded : 2*span - folded);
        targetY = intercept - paddle.h/2;
      }
    }
    // Add intentional shot placement so both perfect predictors create varied angles.
    var shotOffset = Math.sin((rallyHits + 1) * 1.37) * paddle.h * 0.30 * (direction > 0 ? 1 : -1);
    targetY -= shotOffset;
    targetY = Math.max(0, Math.min(H - paddle.h, targetY));
    var dy = targetY - paddle.y;
    var step = AI_MAX_SPEED * dt;
    if (Math.abs(dy) <= step) paddle.y = targetY;
    else paddle.y += Math.sign(dy) * step;
    paddle.y = Math.max(0, Math.min(H - paddle.h, paddle.y));
    paddle._pretarget = false;
  }

`;
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
      ? 'Two identical GOD CPUs compete using the same Rust/WASM prediction, 900 px/s speed cap and 240 Hz physics.'
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

html=html.replace(old,replacement);\nhtml=html.replace('pscore = 0; cscore = 0;','pscore = 0; cscore = 0;\n    rallyHits = 0;');\nhtml=html.replace('function bouncePaddle(p, hit){','function bouncePaddle(p, hit){\n    rallyHits++;');
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
    while (physicsAccumulator >= PHYSICS_STEP && steps < 24) {
      update(PHYSICS_STEP);
      physicsAccumulator -= PHYSICS_STEP;
      steps++;
    }
    draw();
    requestAnimationFrame(loop);
  }`;
if (!html.includes(oldLoop)) throw new Error('Pong frame loop did not match');
html=html.replace(oldLoop,newLoop);
html=html.replace('var MAX_SPEED = 820;','var MAX_SPEED = 1350;');\nhtml=html.replace('var SPEED_INC = 28;','var SPEED_INC = 45;');\nhtml=html.replace('var AI_MAX_SPEED = 360;','var AI_MAX_SPEED = 900;\n  var pongGodWasm = null;\n  fetch("./pong-ai.wasm").then(function(r){ if(!r.ok) throw new Error("WASM unavailable"); return r.arrayBuffer(); }).then(function(bytes){ return WebAssembly.instantiate(bytes); }).then(function(result){ pongGodWasm = result.instance.exports; }).catch(function(){ console.warn("Pong GOD CPU: using JavaScript fallback."); });');
fs.writeFileSync(file,html);
console.log('Pong GOD CPU patched: Rust/WASM trajectory prediction, reflected wall math, 900 px/s movement, JS fallback.');
