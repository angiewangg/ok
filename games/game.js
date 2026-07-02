const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
function resize(){canvas.width = Math.min(window.innerWidth-40,1200); canvas.height = Math.floor(window.innerHeight*0.8);}resize();
window.addEventListener('resize', resize);

const keys = {};
window.addEventListener('keydown', e=>keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e=>keys[e.key.toLowerCase()] = false);

let mouse = {x:0,y:0,down:false};
canvas.addEventListener('mousemove', e=>{const r=canvas.getBoundingClientRect();mouse.x=e.clientX-r.left;mouse.y=e.clientY-r.top});
canvas.addEventListener('mousedown', ()=>mouse.down=true);
canvas.addEventListener('mouseup', ()=>mouse.down=false);

const player = {x:300,y:200,r:14,angle:0,speed:220,health:100,fireCooldown:0};
const bullets = [];
const enemies = [];

function spawnEnemy(){const side=Math.random()*4|0;let x,y; if(side===0){x= -20; y=Math.random()*canvas.height}else if(side===1){x=canvas.width+20;y=Math.random()*canvas.height}else if(side===2){x=Math.random()*canvas.width;y=-20}else{x=Math.random()*canvas.width;y=canvas.height+20}enemies.push({x,y,r:12,spd:60+Math.random()*80})}

let safe = {x:canvas.width/2,y:canvas.height/2,r:Math.min(canvas.width,canvas.height)*0.45,shrinkStart:Date.now()+8000,shrinkRate:0.02};

function update(dt){player.angle=Math.atan2(mouse.y-player.y,mouse.x-player.x);
let mvx=0,mvy=0; if(keys['w'])mvy-=1;if(keys['s'])mvy+=1;if(keys['a'])mvx-=1;if(keys['d'])mvx+=1; if(mvx||mvy){const L=Math.hypot(mvx,mvy);mvx/=L;mvy/=L;player.x+=mvx*player.speed*dt;player.y+=mvy*player.speed*dt}
player.x=Math.max(0,Math.min(canvas.width,player.x));player.y=Math.max(0,Math.min(canvas.height,player.y));
if(mouse.down && player.fireCooldown<=0){const speed=500;bullets.push({x:player.x,y:player.y,dx:Math.cos(player.angle)*speed,dy:Math.sin(player.angle)*speed,r:4});player.fireCooldown=0.18}
player.fireCooldown=Math.max(0,player.fireCooldown-dt);

for(let i=bullets.length-1;i>=0;i--){const b=bullets[i];b.x+=b.dx*dt;b.y+=b.dy*dt; if(b.x< -50||b.x>canvas.width+50||b.y< -50||b.y>canvas.height+50)bullets.splice(i,1)}

for(let i=enemies.length-1;i>=0;i--){const e=enemies[i];const ang=Math.atan2(player.y-e.y,player.x-e.x);e.x+=Math.cos(ang)*e.spd*dt;e.y+=Math.sin(ang)*e.spd*dt;for(let j=bullets.length-1;j>=0;j--){const b=bullets[j];const dx=b.x-e.x,dy=b.y-e.y;if(dx*dx+dy*dy<(b.r+e.r)*(b.r+e.r)){enemies.splice(i,1);bullets.splice(j,1);break}} if(i>=0&&Math.hypot(player.x-e.x,player.y-e.y)<player.r+e.r){player.health-=20*dt;enemies.splice(i,1)}}

if(Math.random()<dt*0.5 && enemies.length<12) spawnEnemy();

if(Date.now()>safe.shrinkStart){safe.r=Math.max(40,safe.r - safe.shrinkRate*(canvas.width+canvas.height)*dt)}
const dToSafe=Math.hypot(player.x - safe.x, player.y - safe.y);
if(dToSafe>safe.r) player.health -= 10*dt;
player.health=Math.max(0,player.health);
}

function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);
ctx.fillStyle='#071022';ctx.fillRect(0,0,canvas.width,canvas.height);
ctx.beginPath();ctx.fillStyle='rgba(50,120,255,0.06)';ctx.arc(safe.x,safe.y,safe.r,0,Math.PI*2);ctx.fill();
ctx.beginPath();ctx.strokeStyle='rgba(80,180,255,0.18)';ctx.lineWidth=3;ctx.arc(safe.x,safe.y,safe.r,0,Math.PI*2);ctx.stroke();
for(const b of bullets){ctx.fillStyle='#ffd166';ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.fill()}
for(const e of enemies){ctx.fillStyle='#ff6b6b';ctx.beginPath();ctx.rect(e.x-e.r,e.y-e.r,e.r*2,e.r*2);ctx.fill()}
ctx.save();ctx.translate(player.x,player.y);ctx.rotate(player.angle);
ctx.fillStyle='#4cc9f0';ctx.beginPath();ctx.arc(0,0,player.r,0,Math.PI*2);ctx.fill();ctx.restore();
ctx.fillStyle='#fff';ctx.font='16px Arial';ctx.fillText(`Health: ${Math.round(player.health)}`,12,22);
ctx.fillText(`Enemies: ${enemies.length}`,12,42);
ctx.fillText(`Safe radius: ${Math.round(safe.r)}`,12,62);
if(player.health<=0){ctx.fillStyle='rgba(0,0,0,0.6)';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#fff';ctx.font='36px Arial';ctx.fillText('You Died',canvas.width/2-70,canvas.height/2)}
}

let last=performance.now();function loop(t){const dt=(t-last)/1000;last=t;update(dt);draw();requestAnimationFrame(loop)}requestAnimationFrame(loop);
