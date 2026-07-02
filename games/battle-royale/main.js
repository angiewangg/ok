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

// Scheduled bot drops (simulate other players boarding and dropping)
function scheduleBots(count){
  const start = performance.now() + 2000;
  for(let i=0;i<count;i++){
    const delay = start + i*3000 + Math.random()*5000;
    enemies.push({state:'scheduled', spawnTime:delay, x:Math.random()*canvas.width, y:-60, r:12, hp:120, spd:60, fireCooldown:1.5, alive:true, isBot:true});
  }
}

// Safe zone
const safe = {x:canvas.width/2,y:canvas.height/2,r:Math.min(canvas.width,canvas.height)*0.45,shrinkTime:30,shrinkStart:performance.now()+20000,shrinkRate:0.6};

// Match timing and UI
let matchStart = null;
const killFeed = [];

// Input
const keys = {}; window.addEventListener('keydown',e=>keys[e.key.toLowerCase()]=true); window.addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);
const mouse = {x:0,y:0,down:false,right:false};
canvas.addEventListener('mousemove',e=>{const r=canvas.getBoundingClientRect();mouse.x=e.clientX-r.left;mouse.y=e.clientY-r.top});
canvas.addEventListener('mousedown',(e)=>{ if(e.button===0) mouse.down=true; if(e.button===2) mouse.right=true });
canvas.addEventListener('mouseup',(e)=>{ if(e.button===0) mouse.down=false; if(e.button===2) mouse.right=false });
canvas.addEventListener('contextmenu', e=>e.preventDefault());

// keyboard: 'k' to shoot, Shift or right mouse for aim (zoom)
window.addEventListener('keydown', e=>{ if(e.key.toLowerCase()==='k') keys['k']=true; if(e.key==='Shift') { if(player) player.aiming = true } });
window.addEventListener('keyup', e=>{ if(e.key.toLowerCase()==='k') keys['k']=false; if(e.key==='Shift') { if(player) player.aiming = false } });

// Helpers
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}

// Normalize angle to [-PI, PI]
function normalizeAngle(a){ while(a>Math.PI) a-=Math.PI*2; while(a<-Math.PI) a+=Math.PI*2; return a }

// Convert screen coords to world coords based on camera/zoom
let zoom = 1, targetZoom = 1;
function screenToWorld(sx, sy){
  if(!player) return {x: sx, y: sy};
  const cx = player.x; const cy = player.y;
  const wx = cx + (sx - canvas.width/2)/zoom;
  const wy = cy + (sy - canvas.height/2)/zoom;
  return {x: wx, y: wy};
}

function findNearestEnemyAngle(x,y,maxDist){ let best=null, bestD=Infinity; for(const e of enemies){ const d=Math.hypot(e.x-x,e.y-y); if(d<maxDist && d<bestD){ bestD=d; best=e; }} return best? Math.atan2(best.y-y,best.x-x) : null }

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
  // schedule bot drops instead of immediate enemies
  scheduleBots(8);
  for(let i=0;i<6;i++) spawnEnemy(Math.random()*canvas.width, groundY()-20 - Math.random()*200);
  // weapon crates
  for(let i=0;i<4;i++){ const x=Math.random()*canvas.width, y=groundY()-20 - Math.random()*120; spawnWeapon(x,y, i%2? 'rifle':'pistol') }
}

// Update loop
function update(dt){
  nowMs = performance.now();
  // cap dt to avoid big jumps
  dt = Math.min(dt, 0.05);
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

      // Process scheduled bot drops
      for(const b of enemies){
        if(b.state==='scheduled' && nowMs >= b.spawnTime){ b.state='inAir'; b.x = Math.random()*canvas.width; b.y = -40; b.vx = (Math.random()-0.5)*80; b.vy = 40 + Math.random()*40; b.parachute=false; }
        if(b.state==='inAir'){
          // parachute opens after falling
          if(!b.parachute && b.vy>160) b.parachute = true;
          if(b.parachute){ b.vy = clamp(b.vy + 30*dt, -200, 220); b.vx *= 0.995 }
          b.x += b.vx * dt; b.y += b.vy * dt;
          if(b.y >= groundY() - b.r){ b.y = groundY() - b.r; b.state='landed'; b.aiState='search'; }
        }
      }
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
      // Determine world mouse (account for zoom/camera)
      const worldMouse = screenToWorld(mouse.x, mouse.y);
      // aim assist: if aiming (right-click or shift), nudge aim toward nearest enemy
      // ensure aiming state follows input
      player.aiming = mouse.right || keys['shift'] || player.aiming;
      let aimAngle = Math.atan2(worldMouse.y - player.y, worldMouse.x - player.x);
      if(player.aiming){
        const assist = findNearestEnemyAngle(player.x, player.y, 220);
        if(assist !== null){
          // blend angles slightly toward target
          const diff = normalizeAngle(assist - aimAngle);
          aimAngle += diff * 0.35; // assist strength
        }
      }
      // shooting: left click or 'k' key
      const shooting = mouse.down || keys['k'];
      if(shooting && player.fireCooldown<=0){ const dir = aimAngle; bullets.push({x:player.x,y:player.y,dx:Math.cos(dir)*520,dy:Math.sin(dir)*520,owner:'player',r:3,dir}); player.fireCooldown= (player.weapon && WEAPONS[player.weapon])? (1/WEAPONS[player.weapon].fireRate) : 0.5; }
      player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    }

    // bullets
    for(let i=bullets.length-1;i>=0;i--){const b=bullets[i]; b.x += b.dx*dt; b.y += b.dy*dt; if(b.x< -50||b.x>canvas.width+50||b.y< -50||b.y>canvas.height+50) bullets.splice(i,1)}

    // Enemies behavior
    for(let i=enemies.length-1;i>=0;i--){const e=enemies[i]; if(!e.alive) continue; if(e.state && (e.state==='scheduled' || e.state==='inAir')) continue; const dx=player.x-e.x, dy=player.y-e.y; const dist=Math.hypot(dx,dy);
      // simple AI: approach, strafe, or retreat based on hp
      if(dist>220){ e.x += (dx/dist)*e.spd*dt; e.y += (dy/dist)*e.spd*dt }
      else if(dist<120){ // too close -> strafe away
        const ang = Math.atan2(dy,dx)+Math.PI/2; e.x += Math.cos(ang)*e.spd*0.8*dt; e.y += Math.sin(ang)*e.spd*0.8*dt;
      }
      // fire when in range
      e.fireCooldown -= dt; if(e.fireCooldown<=0 && dist<420){ const ang=Math.atan2(player.y-e.y, player.x-e.x); bullets.push({x:e.x,y:e.y,dx:Math.cos(ang)*320,dy:Math.sin(ang)*320,owner:'enemy',r:4,dir:ang}); e.fireCooldown = 0.9 + Math.random()*1.6 }
      // hit by player bullets
      for(let j=bullets.length-1;j>=0;j--){const b=bullets[j]; if(b.owner==='player'){const dd=(b.x-e.x)*(b.x-e.x)+(b.y-e.y)*(b.y-e.y); if(dd < (b.r+e.r)*(b.r+e.r)){e.hp-=40; bullets.splice(j,1); if(e.hp<=0){e.alive=false; enemies.splice(i,1); killFeed.unshift({text:'You eliminated an enemy',time:nowMs}); if(killFeed.length>6) killFeed.pop(); break}}}}
    }

    // bullets hitting player
    for(let i=bullets.length-1;i>=0;i--){const b=bullets[i]; if(b.owner==='enemy'){const dx=b.x-player.x, dy=b.y-player.y; if(dx*dx+dy*dy < (b.r+player.r)*(b.r+player.r)){
        // apply to shield first
        let dmg = 18;
        if(player.shield>0){ const s = Math.min(player.shield, dmg); player.shield -= s; dmg -= s; }
        if(dmg>0) player.hp -= dmg;
        bullets.splice(i,1);
        if(player.hp<=0){state='gameOver'; statusEl.textContent='You Died'; promptEl.classList.remove('hidden'); promptEl.textContent='Refresh to retry';}
      }}}

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
  // Camera transform and world drawing
  // smooth zoom toward targetZoom
  targetZoom = (player && player.aiming) ? 1.6 : 1.0;
  zoom += (targetZoom - zoom) * Math.min(12* (1/60), 12* (Math.max(0.001, (1/60))));
  // Center camera on player or center if none
  const camX = player? player.x : canvas.width/2;
  const camY = player? player.y : canvas.height/2;
  ctx.save();
  ctx.translate(canvas.width/2, canvas.height/2);
  ctx.scale(zoom, zoom);
  ctx.translate(-camX, -camY);

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

  // draw bullets as elongated projectiles
  for(const b of bullets){ ctx.save(); ctx.translate(b.x,b.y); const angle = b.dir || Math.atan2(b.dy,b.dx); ctx.rotate(angle);
      const len = 14; const w = 4; ctx.fillStyle = b.owner==='player' ? '#bfc0c2' : '#ff6b6b';
      // simple 3D shading: gradient
      const grad = ctx.createLinearGradient(-len/2,0,len/2,0); grad.addColorStop(0,'rgba(255,255,255,0.9)'); grad.addColorStop(0.5,ctx.fillStyle); grad.addColorStop(1,'rgba(0,0,0,0.6)'); ctx.fillStyle = grad;
      ctx.beginPath(); ctx.ellipse(0,0,len, w, 0, 0, Math.PI*2); ctx.fill();
    ctx.restore(); }

  // draw enemies / bots as stylized icons (appear after scheduled drop)
  for(const e of enemies){
    if(e.state === 'scheduled') continue;
    // pseudo-3D scale based on vertical position
    const depthScale = 1 - ((e.y||0)/groundY())*0.18;
    const ex = e.x, ey = e.y;
    // shadow
    ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(ex, groundY()+4, 14*depthScale, 6*depthScale, 0, 0, Math.PI*2); ctx.fill();
    // body
    ctx.save(); ctx.translate(ex,ey); ctx.scale(depthScale, depthScale);
    ctx.fillStyle = e.isBot? '#7c5cff' : '#ff6b6b'; roundRect(ctx,-12,-12,24,24,6); ctx.fill();
    // head
    ctx.fillStyle='#ffdca8'; ctx.beginPath(); ctx.arc(0,-14,8,0,Math.PI*2); ctx.fill();
    ctx.restore();
    // parachute for bots in air
    if(e.state === 'inAir' && e.parachute){ ctx.fillStyle='#ff9ab8'; ctx.beginPath(); ctx.ellipse(e.x, e.y-22, 48,18,0,Math.PI,0); ctx.fill(); ctx.fillStyle='#fff'; ctx.beginPath(); ctx.moveTo(e.x-18, e.y-2); ctx.lineTo(e.x, e.y-12); ctx.lineTo(e.x+18, e.y-2); ctx.fill(); }
  }

  // draw loot
  for(const L of loot){ ctx.fillStyle='#f4d35e'; ctx.beginPath(); ctx.rect(L.x-6,L.y-6,12,12); ctx.fill(); }

  ctx.restore();

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
     ctx.strokeStyle='#ffd166'; ctx.lineWidth=2; roundRect(ctx,sx,hbYc+8,slotW,48,8); ctx.stroke();
     // draw stylized grey gun icon
     const gx = sx+slotW/2, gy = hbYc+32; ctx.fillStyle='#9aa0a6'; roundRect(ctx,gx-22,gy-8,44,14,6); ctx.fill(); ctx.fillStyle='#6b7176'; roundRect(ctx,gx+12,gy-6,8,8,3); ctx.fill();
     ctx.fillStyle='#fff'; ctx.font='11px Segoe UI'; ctx.fillText(`Ammo: ${player.ammo}`, sx+8, hbYc+44);
    } }

  // bottom-right: small info
  const brX = canvas.width - 180, brY = canvas.height - 110; ctx.fillStyle='rgba(0,0,0,0.35)'; roundRect(ctx,brX,brY,160,80,8); ctx.fill(); ctx.fillStyle='#fff'; ctx.font='13px Segoe UI'; ctx.fillText('Storm in: 0:30', brX+12, brY+26); ctx.fillText('Ping: 42ms', brX+12, brY+46);

  if(state==='gameOver'){ ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.fillStyle='#fff'; ctx.font='44px Segoe UI'; ctx.fillText(statusEl.textContent, canvas.width/2-120, canvas.height/2); }
}

// Main loop
let last = performance.now(); function loop(t){ const dt=(t-last)/1000; last=t; update(dt); draw(); requestAnimationFrame(loop) } requestAnimationFrame(loop);

// Input: space to 'jump' (advance to drop state)
window.addEventListener('keydown', e=>{
  if(e.code==='Space' && (state==='readyToJump' || state==='boarding')){
    // create player at bus position and set initial jump velocity
    player = {x: bus.x + bus.w/2, y: bus.y+bus.h+6, vx: (Math.random()-0.5)*60, vy: -60, r:12, h:36, hp:100, shield:50, ammo:30, weapon:'pistol', speed:160, fireCooldown:0, parachute:false, jumpTime:performance.now(), aiming:false};
    state = 'inAir'; statusEl.textContent = 'In Air'; promptEl.classList.add('hidden');
    matchStart = performance.now();
  }
});

// Prevent accidental text selection/double events
window.addEventListener('blur', ()=>{ for(const k in keys) keys[k]=false; mouse.down=false });

