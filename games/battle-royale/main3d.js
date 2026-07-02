// Minimal three.js-based Battle Royale prototype
(function(){
  const container = document.querySelector('.container');
  const width = window.innerWidth, height = window.innerHeight;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  const camera = new THREE.PerspectiveCamera(60, width/height, 0.1, 5000);
  camera.position.set(0, 120, 260);

  const renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = false;
  container.appendChild(renderer.domElement);

  // lights
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(100,200,100); scene.add(dir);
  scene.add(new THREE.AmbientLight(0xffffff,0.5));

  // ground
  const groundMat = new THREE.MeshStandardMaterial({color:0x3aa047});
  const groundGeo = new THREE.PlaneGeometry(3000,3000,10,10);
  const ground = new THREE.Mesh(groundGeo, groundMat); ground.rotation.x = -Math.PI/2; ground.position.y = 0; scene.add(ground);

  // Battle bus (simple box)
  const busGeo = new THREE.BoxGeometry(120,40,40);
  const busMat = new THREE.MeshStandardMaterial({color:0x2b6cb0});
  const bus = new THREE.Mesh(busGeo, busMat); bus.position.set(-600,140,-200); scene.add(bus);

  // Player model (simple)
  const player = {mesh:null, alive:false};
  function createPlayerMesh(){
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(18,28,10), new THREE.MeshStandardMaterial({color:0x2f2f2f})); body.position.y=14; group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(7,12,12), new THREE.MeshStandardMaterial({color:0xffdca8})); head.position.y=34; group.add(head);
    return group;
  }

  // Bots container
  const bots = [];
  function scheduleBots(n){
    const start = performance.now() + 2000;
    for(let i=0;i<n;i++){
      const t = start + i*3000 + Math.random()*5000;
      bots.push({state:'scheduled', spawnTime:t, mesh:null, pos:new THREE.Vector3(Math.random()*1000-500,400,Math.random()*800-400)});
    }
  }

  // bullets
  const bullets = [];
  const bulletGeo = new THREE.CylinderGeometry(1.6,1.6,12,8);
  const bulletMat = new THREE.MeshStandardMaterial({color:0xbfc0c2,metalness:0.6,roughness:0.4});

  // HUD overlay element
  const overlay = document.createElement('div'); overlay.style.position='fixed'; overlay.style.left='0'; overlay.style.top='0'; overlay.style.width='100%'; overlay.style.height='100%'; overlay.style.pointerEvents='none'; document.body.appendChild(overlay);
  const info = document.createElement('div'); info.style.position='absolute'; info.style.top='12px'; info.style.left='50%'; info.style.transform='translateX(-50%)'; info.style.color='#fff'; info.style.font='14px Segoe UI'; overlay.appendChild(info);

  // Input
  let aiming=false, shooting=false;
  window.addEventListener('mousedown', e=>{ if(e.button===0) shooting=true; if(e.button===2) aiming=true; });
  window.addEventListener('mouseup', e=>{ if(e.button===0) shooting=false; if(e.button===2) aiming=false; });
  window.addEventListener('contextmenu', e=>e.preventDefault());
  window.addEventListener('keydown', e=>{ if(e.code==='Space') startJump(); if(e.key.toLowerCase()==='k') shooting=true; if(e.key==='Shift') aiming=true; });
  window.addEventListener('keyup', e=>{ if(e.key.toLowerCase()==='k') shooting=false; if(e.key==='Shift') aiming=false; });

  // Camera controls smoothing
  let targetFov = 60;

  function startJump(){
    if(player.alive) return;
    player.mesh = createPlayerMesh(); player.mesh.position.set(bus.position.x, bus.position.y-20, bus.position.z+40); scene.add(player.mesh); player.alive=true; player.v = new THREE.Vector3((Math.random()-0.5)*40, -80, 120); player.parachute=false; player.hp=100; player.shield=50;
  }

  // schedule bots
  scheduleBots(8);

  // animate
  let last = performance.now();
  function animate(){
    const now = performance.now(); const dt = Math.min((now-last)/1000, 0.05); last = now;

    // move bus left->right
    bus.position.x += 160 * dt;
    if(bus.position.x > 800) bus.position.x = -800;

    // bots schedule
    for(const b of bots){
      if(b.state==='scheduled' && now >= b.spawnTime){
        // create mesh
        const m = createPlayerMesh(); m.scale.set(0.9,0.9,0.9); scene.add(m); b.mesh = m; b.state='inAir'; b.v = new THREE.Vector3((Math.random()-0.5)*40, -40, (Math.random()*40)+80); b.mesh.position.copy(b.pos);
      }
      if(b.state==='inAir' && b.mesh){
        if(!b.parachute && b.v.y < -150) b.parachute=true;
        if(b.parachute) b.v.y = Math.min(b.v.y + 30*dt, 220);
        b.mesh.position.addScaledVector(b.v, dt);
        if(b.mesh.position.y <= 0){ b.mesh.position.y = 0; b.state='landed'; b.aiTimer=1+Math.random()*2; }
      }
      if(b.state==='landed' && b.mesh){
        // simple idle movement
        b.aiTimer -= dt; if(b.aiTimer<=0){ b.aiTimer = 1+Math.random()*3; b.mesh.position.x += (Math.random()-0.5)*40; b.mesh.position.z += (Math.random()-0.5)*40; }
      }
    }

    // player physics
    if(player.alive && player.mesh){
      if(!player.parachute){ player.v.y += 400*dt; }
      else { player.v.y = Math.min(player.v.y + 30*dt, 220); player.v.x *= 0.995; }
      player.mesh.position.addScaledVector(player.v, dt);
      if(player.mesh.position.y <= 0){ player.mesh.position.y = 0; player.parachute=false; }

      // shooting spawns bullets forward from player
      if(shooting){ // spawn at rate
        if(!player.lastShot || now - player.lastShot > 180){
          const b = new THREE.Mesh(bulletGeo, bulletMat); b.rotation.z = Math.PI/2; b.position.copy(player.mesh.position); b.position.y += 10; b.dir = new THREE.Vector3(0,0,-1).applyQuaternion(player.mesh.quaternion); bullets.push({mesh:b,vel:b.dir.clone().multiplyScalar(520)}); scene.add(b); player.lastShot = now;
        }
      }
    }

    // update bullets
    for(let i=bullets.length-1;i>=0;i--){ const bl=bullets[i]; bl.mesh.position.addScaledVector(bl.vel, dt); if(bl.mesh.position.length()>5000) { scene.remove(bl.mesh); bullets.splice(i,1); } }

    // camera follow player or bus
    let camTarget = player.alive && player.mesh ? player.mesh.position : bus.position;
    camera.position.lerp(new THREE.Vector3(camTarget.x, camTarget.y+120, camTarget.z+260), 0.08);
    camera.lookAt(new THREE.Vector3(camTarget.x, camTarget.y+20, camTarget.z));
    // FOV smooth
    const desiredFov = aiming ? 40 : 60; camera.fov += (desiredFov - camera.fov) * 0.08; camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    info.textContent = `HP: ${player.alive?player.hp:0}  Bots: ${bots.filter(b=>b.state!=='scheduled').length}`;
    requestAnimationFrame(animate);
  }
  animate();

  // resize
  window.addEventListener('resize', ()=>{ const w=window.innerWidth, h=window.innerHeight; camera.aspect = w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h); });
})();
