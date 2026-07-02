// Minimal three.js-based Battle Royale prototype
(function(){
  const container = document.querySelector('.container');
  const width = window.innerWidth, height = window.innerHeight;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  const camera = new THREE.PerspectiveCamera(60, width/height, 0.1, 5000);
  camera.position.set(0, 120, 260);
  scene.add(camera);

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
  // Battle bus (will use GLTF if available, fallback to box)
  let bus = null;
  const busGeo = new THREE.BoxGeometry(120,40,40);
  const busMat = new THREE.MeshStandardMaterial({color:0x2b6cb0});
  bus = new THREE.Mesh(busGeo, busMat); bus.position.set(-600,140,-200); scene.add(bus);

  // GLTF support (will replace primitives when files present)
  let gltfLoader = null; let playerGLTF = null; let busGLTF = null;
  if(THREE && THREE.GLTFLoader){
    try{ gltfLoader = new THREE.GLTFLoader();
      gltfLoader.load('assets/player.glb', (g)=>{ playerGLTF = g.scene; }, undefined, ()=>{});
      gltfLoader.load('assets/bus.glb', (g)=>{ busGLTF = g.scene; if(bus){ scene.remove(bus); bus = busGLTF.clone(); bus.position.set(-600,140,-200); scene.add(bus); } }, undefined, ()=>{});
    }catch(e){ /* loader not available */ }
  }

  // Player model (simple)
  const player = {mesh:null, alive:false};
  function createPlayerMesh(){
    if(playerGLTF) return playerGLTF.clone();
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

  // 3D HUD: canvas texture mapped to a plane attached to the camera
  const hudCanvas = document.createElement('canvas'); hudCanvas.width = 512; hudCanvas.height = 256;
  const hudCtx = hudCanvas.getContext('2d');
  const hudTexture = new THREE.CanvasTexture(hudCanvas);
  hudTexture.minFilter = THREE.LinearFilter;
  const hudMat = new THREE.MeshBasicMaterial({map: hudTexture, transparent:true});
  const hudGeo = new THREE.PlaneGeometry(1.92, 0.96); // aspect ~512/256
  const hudMesh = new THREE.Mesh(hudGeo, hudMat);
  hudMesh.renderOrder = 999;
  hudMesh.material.depthTest = false;
  hudMesh.material.depthWrite = false;
  hudMesh.position.set(0, -40, -110);
  camera.add(hudMesh);

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

    // draw HUD onto canvas texture
    hudCtx.clearRect(0,0,hudCanvas.width,hudCanvas.height);
    // background (transparent)
    // HP bar
    hudCtx.fillStyle = 'rgba(0,0,0,0.6)'; hudCtx.fillRect(12,12,260,36);
    const hp = player.alive ? player.hp : 0;
    hudCtx.fillStyle = '#e53935'; hudCtx.fillRect(16,16, (hp/100)*252,28);
    hudCtx.fillStyle = '#ffffff'; hudCtx.font = '18px Segoe UI'; hudCtx.fillText(`HP: ${hp}`, 20, 40);
    // minimap
    const mmSize = 120; const mmX = hudCanvas.width - mmSize - 12; const mmY = 12;
    hudCtx.fillStyle = 'rgba(0,0,0,0.6)'; hudCtx.fillRect(mmX, mmY, mmSize, mmSize);
    hudCtx.fillStyle = '#9aa0a6'; hudCtx.fillRect(mmX+4, mmY+4, mmSize-8, mmSize-8);
    // draw player/bots on minimap
    function worldToMinimap(pos){ const worldSize=3000; const mx = ((pos.x + worldSize/2)/worldSize)*(mmSize-8); const mz = ((pos.z + worldSize/2)/worldSize)*(mmSize-8); return {x: mmX+4+mx, y: mmY+4+mz}; }
    if(player.alive && player.mesh){ const p = worldToMinimap(player.mesh.position); hudCtx.fillStyle='#00ff00'; hudCtx.fillRect(p.x-3,p.y-3,6,6); }
    for(const b of bots){ if(b.state!=='scheduled' && b.mesh){ const p = worldToMinimap(b.mesh.position); hudCtx.fillStyle='#ff0000'; hudCtx.fillRect(p.x-2,p.y-2,4,4); } }
    hudTexture.needsUpdate = true;

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();

  // resize
  window.addEventListener('resize', ()=>{ const w=window.innerWidth, h=window.innerHeight; camera.aspect = w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h); });
})();
