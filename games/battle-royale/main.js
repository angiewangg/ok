const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
function fit(){canvas.width=window.innerWidth;canvas.height=window.innerHeight}fit();window.addEventListener('resize',fit);

const statusEl = document.getElementById('status');
const promptEl = document.getElementById('prompt');

// Utility draw helpers
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath()}

// Game states: boarding -> readyToJump -> inAir -> landing -> playing -> gameOver
let state = 'boarding';

// Timing / world
let nowMs = performance.now();

// Battle bus
const bus = {x:-360,y:120,w:300,h:90,speed:220,color:'#2b6cb0'};
let busStart = performance.now();

// World and map
const groundY = () => canvas.height*0.8;
const map = {w:canvas.width,h:canvas.height};

// Player (will be created at jump)
let player = null;

// Load player sprite (simple SVG placeholder)
const playerImg = new Image(); playerImg.src = 'assets/player.svg';

// Entities
const bullets = [];
const enemies = [];
const loot = [];

// Safe zone
const safe = {x:canvas.width/2,y:canvas.height/2,r:Math.min(canvas.width,canvas.height)*0.45,shrinkTime:30,shrinkStart:performance.now()+20000,shrinkRate:0.6};

// Match timing and UI
let matchStart = null;
const killFeed = [];

// Input
const keys = {}; window.addEventListener('keydown',e=>keys[e.key.toLowerCase()]=true); window.addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);
const mouse = {x:0,y:0,down:false};
canvas.addEventListener('mousemove',e=>{const r=canvas.getBoundingClientRect();mouse.x=e.clientX-r.left;mouse.y=e.clientY-r.top});
canvas.addEventListener('mousedown',()=>mouse.down=true);canvas.addEventListener('mouseup',()=>mouse.down=false);

// Helpers
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}

// Spawn simple AI enemies
function spawnEnemy(x,y){enemies.push({x,y,r:12,hp:60,spd:40,fireCooldown:Math.random()*2,alive:true})}
function spawnLoot(x,y){loot.push({x,y,type:'ammo'});}

// Weapons definitions
const WEAPONS = {
  pistol: {name:'Pistol', dmg:22, fireRate:4, ammoPerPickup:18},
  rifle: {name:'Rifle', dmg:36, fireRate:8, ammoPerPickup:24}
};

function spawnWeapon(x,y,weapon){loot.push({x,y,type:'weapon',weapon});}

// Initialize some loot and enemies on the map after landing
function populateMap(){
  for(let i=0;i<10;i++) spawnLoot(Math.random()*canvas.width, groundY()-20 - Math.random()*120);
  for(let i=0;i<6;i++) spawnEnemy(Math.random()*canvas.width, groundY()-20 - Math.random()*200);
  // weapon crates
  for(let i=0;i<4;i++){ const x=Math.random()*canvas.width, y=groundY()-20 - Math.random()*120; spawnWeapon(x,y, i%2? 'rifle':'pistol') }
}

// Update loop
function update(dt){
  nowMs = performance.now();
  // Boarding -> bus moves
  if(state==='boarding'){
    bus.x += bus.speed * dt;
    if(bus.x > canvas.width/2 - bus.w/2 && nowMs - busStart > 700){bus.speed = 60}
    if(bus.x > canvas.width + 50){state='readyToJump';statusEl.textContent='Drop Ready';promptEl.classList.remove('hidden')}
  }

  // In-air physics
  if(state==='inAir' && player){
    // control gliding before parachute opens
    if(!player.parachute){
      // limited horizontal influence
      if(keys['a']) player.vx -= 40*dt; if(keys['d']) player.vx += 40*dt;
      player.vy += 400*dt; // gravity
      // open parachute automatically when falling fast or after short time
      if(player.vy > 220 || nowMs - player.jumpTime > 1500) player.parachute=true;
    } else {
      // parachute slows descent and gives lateral control
      if(keys['a']) player.vx -= 180*dt; if(keys['d']) player.vx += 180*dt;
      player.vy = clamp(player.vy + 30*dt, -200, 220);
      // gentle drift
      player.vx *= 0.98;
    }
    player.x += player.vx * dt; player.y += player.vy * dt;
    // ground collision
    if(player.y >= groundY() - player.h/2){player.y = groundY() - player.h/2; state='landing'; statusEl.textContent='Landed'; setTimeout(()=>{state='playing'; statusEl.textContent='Playing'; promptEl.classList.add('hidden'); populateMap();}, 600)}
  }

  // Playing state: ground movement, shooting, bullets, enemies
  if(state==='playing'){
    // Player movement
    let mvx=0,mvy=0; if(keys['w']) mvy=-1; if(keys['s']) mvy=1; if(keys['a']) mvx=-1; if(keys['d']) mvx=1;
    if(player){
      if(mvx||mvy){const L=Math.hypot(mvx,mvy); mvx/=L; mvy/=L; player.x += mvx*player.speed*dt; player.y += mvy*player.speed*dt}
      player.x = clamp(player.x, 16, canvas.width-16); player.y = clamp(player.y, 16, groundY()-player.h/2);
      // shooting
      if(mouse.down && player.fireCooldown<=0){const ang=Math.atan2(mouse.y-player.y, mouse.x-player.x); bullets.push({x:player.x,y:player.y,dx:Math.cos(ang)*520,dy:Math.sin(ang)*520,owner:'player',r:4}); player.fireCooldown=0.25}
      player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    }

    // bullets
    for(let i=bullets.length-1;i>=0;i--){const b=bullets[i]; b.x += b.dx*dt; b.y += b.dy*dt; if(b.x< -50||b.x>canvas.width+50||b.y< -50||b.y>canvas.height+50) bullets.splice(i,1)}

    // Enemies behavior
    for(let i=enemies.length-1;i>=0;i--){const e=enemies[i]; if(!e.alive) continue; const dx=player.x-e.x, dy=player.y-e.y; const dist=Math.hypot(dx,dy);
      // move towards player if far
      if(dist>160){ e.x += (dx/dist)*e.spd*dt; e.y += (dy/dist)*e.spd*dt }
      // fire occasionally
      e.fireCooldown -= dt; if(e.fireCooldown<=0 && dist<420){ const ang=Math.atan2(player.y-e.y, player.x-e.x); bullets.push({x:e.x,y:e.y,dx:Math.cos(ang)*300,dy:Math.sin(ang)*300,owner:'enemy',r:4}); e.fireCooldown = 1.2 + Math.random()*1.6 }
      // hit by player bullets
      for(let j=bullets.length-1;j>=0;j--){const b=bullets[j]; if(b.owner==='player'){const dd=(b.x-e.x)*(b.x-e.x)+(b.y-e.y)*(b.y-e.y); if(dd < (b.r+e.r)*(b.r+e.r)){e.hp-=40; bullets.splice(j,1); if(e.hp<=0){e.alive=false; enemies.splice(i,1); killFeed.unshift({text:'You eliminated an enemy',time:nowMs}); if(killFeed.length>6) killFeed.pop(); break}}}}
    }

    // bullets hitting player
    for(let i=bullets.length-1;i>=0;i--){const b=bullets[i]; if(b.owner==='enemy'){const dx=b.x-player.x, dy=b.y-player.y; if(dx*dx+dy*dy < (b.r+player.r)*(b.r+player.r)){player.hp-=18; bullets.splice(i,1); if(player.hp<=0){state='gameOver'; statusEl.textContent='You Died'; promptEl.classList.remove('hidden'); promptEl.textContent='Refresh to retry';}}}}

    // loot pickup
    for(let i=loot.length-1;i>=0;i--){const L=loot[i]; const d=(L.x-player.x)*(L.x-player.x)+(L.y-player.y)*(L.y-player.y); if(d<900){loot.splice(i,1); player.ammo += 12}}

    // kill feed aging
    for(let i=killFeed.length-1;i>=0;i--){ if(nowMs - killFeed[i].time > 6000) killFeed.splice(i,1); }

    // Safe zone shrink
    if(nowMs > safe.shrinkStart){ safe.r = Math.max(60, safe.r - safe.shrinkRate*dt); }
    const dToSafe = Math.hypot(player.x - safe.x, player.y - safe.y); if(dToSafe > safe.r){ player.hp -= 18*dt }

    // Win condition: if player alive and no enemies
    if(enemies.length === 0){ state='gameOver'; statusEl.textContent='Victory!'; promptEl.classList.remove('hidden'); promptEl.textContent='Refresh to play again' }
  }
}

// Draw loop
function drawBus(ctx,b){ ctx.fillStyle=b.color; roundRect(ctx,b.x,b.y,b.w,b.h,12); ctx.fill(); ctx.fillStyle='#a7d0ff'; for(let i=0;i<4;i++) ctx.fillRect(b.x+22+i*60,b.y+22,40,26); ctx.fillStyle='#111'; ctx.beginPath(); ctx.arc(b.x+50,b.y+b.h,14,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(b.x+b.w-50,b.y+b.h,14,0,Math.PI*2); ctx.fill(); }

function draw(){ ctx.clearRect(0,0,canvas.width,canvas.height);
  // sky
  const g = ctx.createLinearGradient(0,0,0,canvas.height); g.addColorStop(0,'#87ceeb'); g.addColorStop(1,'#7aa7d9'); ctx.fillStyle=g; ctx.fillRect(0,0,canvas.width,canvas.height);
  // clouds
  ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.ellipse(canvas.width*0.2,80,80,30,0,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.ellipse(canvas.width*0.5,60,120,36,0,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.ellipse(canvas.width*0.8,90,70,26,0,0,Math.PI*2); ctx.fill();

  // ground
  ctx.fillStyle='#3aa047'; ctx.fillRect(0, groundY(), canvas.width, canvas.height-groundY());
  // some simple boxes as cover
  ctx.fillStyle='#6b4f3a'; ctx.fillRect(120, groundY()-48, 96,48); ctx.fillRect(420, groundY()-64, 140,64); ctx.fillRect(760, groundY()-40, 72,40);

  // safe zone
  ctx.beginPath(); ctx.fillStyle='rgba(80,160,255,0.06)'; ctx.arc(safe.x,safe.y,safe.r,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.strokeStyle='rgba(80,160,255,0.12)'; ctx.lineWidth=3; ctx.arc(safe.x,safe.y,safe.r,0,Math.PI*2); ctx.stroke();

  // draw bus in boarding/inAir
  if(state==='boarding' || state==='readyToJump'){ drawBus(ctx,bus); // draw player on bus
    const px = clamp(bus.x + bus.w/2, bus.x+40, bus.x+bus.w-40); const py = bus.y+10; ctx.fillStyle='#2f2f2f'; ctx.beginPath(); ctx.arc(px,py+28,14,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#ffdca8'; ctx.beginPath(); ctx.arc(px,py+8,9,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#2b2b2b'; ctx.fillRect(px-8,py,16,6);
  }

  // inAir parachute
  if((state==='inAir' || state==='landing' || state==='playing') && player){
    // draw parachute when parachuting
    if(state==='inAir' && player.parachute){ ctx.fillStyle='#ff7bac'; ctx.beginPath(); ctx.ellipse(player.x, player.y-22, 48,18,0,Math.PI,0); ctx.fill(); ctx.fillStyle='#fff'; ctx.beginPath(); ctx.moveTo(player.x-20, player.y-2); ctx.lineTo(player.x, player.y-14); ctx.lineTo(player.x+20, player.y-2); ctx.fill(); }
    // draw player
    ctx.fillStyle='#2f2f2f'; ctx.beginPath(); ctx.arc(player.x,player.y,player.r,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#ffdca8'; ctx.beginPath(); ctx.arc(player.x,player.y-18,10,0,Math.PI*2); ctx.fill();
  }

  // draw bullets
  for(const b of bullets){ ctx.fillStyle = b.owner==='player' ? '#ffd166' : '#ff6b6b'; ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill(); }

  // draw enemies
  for(const e of enemies){ ctx.fillStyle='#ff6b6b'; ctx.fillRect(e.x-e.r,e.y-e.r,e.r*2,e.r*2); }

  // draw loot
  for(const L of loot){ ctx.fillStyle='#f4d35e'; ctx.beginPath(); ctx.rect(L.x-6,L.y-6,12,12); ctx.fill(); }

  // HUD - top-left minimap
  const mmW = 160, mmH = 112; ctx.save(); ctx.globalAlpha = 0.95; ctx.fillStyle='rgba(8,12,18,0.6)'; roundRect(ctx,12,12,mmW,mmH,8); ctx.fill();
  ctx.fillStyle='#fff'; ctx.font='12px Segoe UI'; ctx.fillText('Minimap',26,30);
  // map dot for player
  if(player){ const mx = 26 + (player.x / canvas.width) * (mmW-36); const my = 36 + (player.y / groundY()) * (mmH-48); ctx.fillStyle='#ffd166'; ctx.beginPath(); ctx.arc(mx,my,5,0,Math.PI*2); ctx.fill(); }
  ctx.restore();

  // top-center: match timer and players left
  const headerY = 18; ctx.fillStyle='rgba(0,0,0,0.25)'; roundRect(ctx, canvas.width/2 - 160, headerY, 320, 36, 8); ctx.fill(); ctx.fillStyle='#fff'; ctx.font='14px Segoe UI';
  const elapsed = matchStart ? Math.floor((nowMs - matchStart)/1000) : 0; const timerText = `Match: ${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`;
  ctx.fillText(timerText, canvas.width/2 - 120, headerY + 22);
  ctx.fillText(`Players: ${enemies.length + (player?1:0)}`, canvas.width/2 + 10, headerY + 22);

  // top-right: kill feed
  const kx = canvas.width - 220, ky = 16; ctx.fillStyle='rgba(0,0,0,0.18)'; roundRect(ctx,kx,ky,208,120,8); ctx.fill(); ctx.fillStyle='#fff'; ctx.font='13px Segoe UI'; ctx.fillText('Kill Feed', kx+12, ky+20);
  for(let i=0;i<killFeed.length;i++){ ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.fillText(killFeed[i].text, kx+12, ky+40 + i*16); }

  // bottom-left: Health and shield
  if(player){ const hbX = 20, hbY = canvas.height - 110; ctx.fillStyle='rgba(0,0,0,0.45)'; roundRect(ctx,hbX,hbY,220,72,10); ctx.fill(); ctx.fillStyle='#fff'; ctx.font='13px Segoe UI'; ctx.fillText('You', hbX+12, hbY+20);
    // draw portrait
    ctx.drawImage(playerImg, hbX+12, hbY+26, 44, 44);
    // health bar
    const healthW = 140; ctx.fillStyle='#222'; roundRect(ctx,hbX+66,hbY+22,healthW,12,6); ctx.fill(); ctx.fillStyle='#ff6b6b'; roundRect(ctx,hbX+66,hbY+22, Math.max(0,(player.hp/100))*healthW,12,6); ctx.fill(); ctx.fillStyle='#fff'; ctx.fillText(`${Math.round(player.hp)} HP`, hbX+66, hbY+34);
    // shield bar
    ctx.fillStyle='#222'; roundRect(ctx,hbX+66,hbY+40,healthW,10,6); ctx.fill(); ctx.fillStyle='#4cc9f0'; roundRect(ctx,hbX+66,hbY+40, Math.max(0,(player.shield/100))*healthW,10,6); ctx.fill(); ctx.fillStyle='#fff'; ctx.fillText(`${Math.round(player.shield)} Shield`, hbX+66, hbY+50);
  }

  // bottom-center: weapon hotbar
  const hbW = 420, hbH = 64; const hbXc = canvas.width/2 - hbW/2, hbYc = canvas.height - hbH - 18; ctx.fillStyle='rgba(0,0,0,0.45)'; roundRect(ctx,hbXc,hbYc,hbW,hbH,12); ctx.fill();
  // slots
  const slots = 5; const slotW = 72; for(let s=0;s<slots;s++){ const sx = hbXc + 12 + s*(slotW+6); ctx.fillStyle='rgba(255,255,255,0.04)'; roundRect(ctx,sx,hbYc+8,slotW,48,8); ctx.fill(); if(player && s===0 && player.weapon){ // show equipped
      ctx.strokeStyle='#ffd166'; ctx.lineWidth=2; roundRect(ctx,sx,hbYc+8,slotW,48,8); ctx.stroke(); ctx.fillStyle='#fff'; ctx.font='12px Segoe UI'; ctx.fillText(WEAPONS[player.weapon].name, sx+8, hbYc+30); ctx.fillText(`Ammo: ${player.ammo}`, sx+8, hbYc+44);
    } }

  // bottom-right: small info
  const brX = canvas.width - 180, brY = canvas.height - 110; ctx.fillStyle='rgba(0,0,0,0.35)'; roundRect(ctx,brX,brY,160,80,8); ctx.fill(); ctx.fillStyle='#fff'; ctx.font='13px Segoe UI'; ctx.fillText('Storm in: 0:30', brX+12, brY+26); ctx.fillText('Ping: 42ms', brX+12, brY+46);

  if(state==='gameOver'){ ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.fillStyle='#fff'; ctx.font='44px Segoe UI'; ctx.fillText(statusEl.textContent, canvas.width/2-120, canvas.height/2); }
}

// Main loop
let last = performance.now(); function loop(t){ const dt=(t-last)/1000; last=t; update(dt); draw(); requestAnimationFrame(loop) } requestAnimationFrame(loop);

// Input: space to 'jump' (advance to drop state)
window.addEventListener('keydown', e=>{
  if(e.code==='Space' && state==='readyToJump'){
    // create player at bus position and set initial jump velocity
    player = {x: bus.x + bus.w/2, y: bus.y+bus.h+6, vx: (Math.random()-0.5)*60, vy: -60, r:12, h:36, hp:100, shield:50, ammo:30, weapon:'pistol', speed:160, fireCooldown:0, parachute:false, jumpTime:performance.now()};
    state = 'inAir'; statusEl.textContent = 'In Air'; promptEl.classList.add('hidden');
    matchStart = performance.now();
  }
});

// Prevent accidental text selection/double events
window.addEventListener('blur', ()=>{ for(const k in keys) keys[k]=false; mouse.down=false });

