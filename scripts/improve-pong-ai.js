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
const replacement=`    // Predictive CPU: decisions use only ball state and field geometry.
    // It never reads the player's paddle position.
    var targetY = H/2;
    if (ball.vx > 0) {
      var travel = Math.max(0, (cpu.x - ball.x) / ball.vx);
      var rawY = ball.y + ball.vy * travel;
      var span = H - 2*ball.r;
      var folded = ((rawY - ball.r) % (2*span) + 2*span) % (2*span);
      var interceptY = ball.r + (folded <= span ? folded : 2*span - folded);
      var skillOffset = Math.sin(ball.y * 0.031 + ball.vy * 0.004) * 9;
      targetY = interceptY - cpu.h/2 + skillOffset;
    } else {
      targetY = H/2 - cpu.h/2;
    }
    targetY = Math.max(0, Math.min(H - cpu.h, targetY));
    var dy = targetY - cpu.y;
    var step = AI_MAX_SPEED * dt;
    if (Math.abs(dy) <= step) cpu.y = targetY;
    else cpu.y += Math.sign(dy) * step;
    cpu.y = Math.max(0, Math.min(H - cpu.h, cpu.y));`;
if(!html.includes(old)) throw new Error('Pong AI block did not match; refusing to patch');
html=html.replace(old,replacement);
fs.writeFileSync(file,html);
console.log('Pong AI patched: ball-only prediction, reflected intercept, smooth paddle movement.');
