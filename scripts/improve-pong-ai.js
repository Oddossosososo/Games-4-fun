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
const replacement=`    // Rust/WASM GOD CPU: exact reflected interception, ball-only inputs.
    var targetY = H/2 - cpu.h/2;
    if (ball.vx > 0) {
      var travel = Math.max(0, (cpu.x - ball.x) / Math.max(1, ball.vx));
      var intercept;
      if (pongGodWasm) {
        intercept = pongGodWasm.predict_intercept_y(ball.y, ball.vy, travel, H, ball.r);
        targetY = pongGodWasm.clamp_paddle_target(intercept, cpu.h, H);
      } else {
        var span = H - 2*ball.r;
        var folded = ((ball.y + ball.vy*travel - ball.r) % (2*span) + 2*span) % (2*span);
        intercept = ball.r + (folded <= span ? folded : 2*span - folded);
        targetY = intercept - cpu.h/2;
      }
    }
    targetY = Math.max(0, Math.min(H - cpu.h, targetY));
    var dy = targetY - cpu.y;
    var step = AI_MAX_SPEED * dt;
    if (Math.abs(dy) <= step) cpu.y = targetY;
    else cpu.y += Math.sign(dy) * step;
    cpu.y = Math.max(0, Math.min(H - cpu.h, cpu.y));`;
if(!html.includes(old)) throw new Error('Pong AI block did not match; refusing to patch');
html=html.replace(old,replacement);
html=html.replace('var AI_MAX_SPEED = 360;','var AI_MAX_SPEED = 720;\n  var pongGodWasm = null;\n  fetch("./pong-ai.wasm").then(function(r){ if(!r.ok) throw new Error("WASM unavailable"); return r.arrayBuffer(); }).then(function(bytes){ return WebAssembly.instantiate(bytes); }).then(function(result){ pongGodWasm = result.instance.exports; }).catch(function(){ console.warn("Pong GOD CPU: using JavaScript fallback."); });');
fs.writeFileSync(file,html);
console.log('Pong GOD CPU patched: Rust/WASM trajectory prediction, reflected wall math, 720 px/s movement, JS fallback.');
