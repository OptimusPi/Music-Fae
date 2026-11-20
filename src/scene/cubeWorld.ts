import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CUBE_HALF_SIZE, MARCH_RING_BASE_RADIUS } from '../shared/protocol';

interface FireflyMote {
  mesh: THREE.Mesh;
  baseAngle: number;
  radius: number;
  baseY: number;
  speed: number;
  bobSpeed: number;
  phase: number;
}

export interface WorldHandles {
  floorCubeGroup: THREE.Group;
  horizonMonoliths: THREE.Group;
  updateAmbient: (dt: number, elapsedSec: number, beatPulse: number) => void;
  disposables: Array<{ dispose: () => void }>;
}

/**
 * Generates a moonlit twilight Fae Forest mossy stone clearing texture for the top of the Big Cube:
 * - Mossy dark slate forest flagstones
 * - Subtle charred stone hearth circle at center (for the campfire — zero logos!)
 * - Soft silver-moss ceremonial Fae dance circle at radius = MARCH_RING_BASE_RADIUS
 * - Carved mossy stone forest perimeter
 */
function createFaeGladeTopTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Rich twilight mossy forest floor base
  ctx.fillStyle = '#1b2824';
  ctx.fillRect(0, 0, size, size);

  // Subtle organic mossy slate flagstone tiles
  const tileCount = 13;
  const tilePx = size / tileCount;
  for (let gx = 0; gx < tileCount; gx++) {
    for (let gy = 0; gy < tileCount; gy++) {
      const hash = ((gx * 37 + gy * 91) % 7) / 7;
      const r = Math.round(25 + hash * 12);
      const g = Math.round(41 + hash * 16);
      const b = Math.round(37 + hash * 12);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(gx * tilePx, gy * tilePx, tilePx, tilePx);
    }
  }

  // Soft mossy stone seams
  ctx.strokeStyle = 'rgba(10, 18, 16, 0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= tileCount; i++) {
    const p = i * tilePx;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  const cx = size / 2;
  const cy = size / 2;

  // Radial twilight clearing vignette (warmer mossy-stone clearing center, deeper mossy forest rim)
  const gladeGrad = ctx.createRadialGradient(cx, cy, size * 0.04, cx, cy, size * 0.52);
  gladeGrad.addColorStop(0, 'rgba(62, 42, 28, 0.45)');
  gladeGrad.addColorStop(0.24, 'rgba(42, 56, 48, 0.2)');
  gladeGrad.addColorStop(0.7, 'rgba(19, 32, 28, 0.12)');
  gladeGrad.addColorStop(1, 'rgba(9, 17, 16, 0.72)');
  ctx.fillStyle = gladeGrad;
  ctx.fillRect(0, 0, size, size);

  // Warm dark basalt hearth apron at exact center (0, 0, 0) for the campfire
  const hearthGrad = ctx.createRadialGradient(cx, cy, 8, cx, cy, size * 0.095);
  hearthGrad.addColorStop(0, 'rgba(34, 24, 20, 0.92)');
  hearthGrad.addColorStop(0.62, 'rgba(44, 34, 30, 0.65)');
  hearthGrad.addColorStop(1, 'rgba(44, 34, 30, 0)');
  ctx.fillStyle = hearthGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.095, 0, Math.PI * 2);
  ctx.fill();

  // Subtle carved stone ring around the campfire hearth
  ctx.strokeStyle = 'rgba(148, 182, 168, 0.22)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.085, 0, Math.PI * 2);
  ctx.stroke();

  // Ceremonial Fae Forest Dance Ring (maps MARCH_RING_BASE_RADIUS / CUBE_HALF_SIZE)
  const marchRadiusPx = (MARCH_RING_BASE_RADIUS / CUBE_HALF_SIZE) * (size / 2);
  ctx.save();
  ctx.strokeStyle = 'rgba(136, 198, 180, 0.11)';
  ctx.lineWidth = 44;
  ctx.beginPath();
  ctx.arc(cx, cy, marchRadiusPx, 0, Math.PI * 2);
  ctx.stroke();

  // Delicate moonlit inner & outer Fae ring stones
  ctx.strokeStyle = 'rgba(154, 224, 208, 0.28)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, marchRadiusPx - 23, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 184, 112, 0.24)';
  ctx.lineWidth = 2;
  ctx.setLineDash([12, 14]);
  ctx.beginPath();
  ctx.arc(cx, cy, marchRadiusPx + 23, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 24 radial standing-stone ticks around the dance ring (nod to 24 FPS)
  ctx.strokeStyle = 'rgba(176, 228, 214, 0.22)';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 24; i++) {
    const ang = (i / 24) * Math.PI * 2;
    const r0 = marchRadiusPx - 12;
    const r1 = marchRadiusPx + 12;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
    ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
    ctx.stroke();
  }
  ctx.restore();

  // Mossy carved stone rim border (organic forest edge, zero industrial hazard stripes)
  const borderW = 30;
  ctx.save();
  ctx.strokeStyle = 'rgba(116, 178, 152, 0.26)';
  ctx.lineWidth = 3;
  ctx.strokeRect(borderW, borderW, size - borderW * 2, size - borderW * 2);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Stratified twilight forest bedrock cliff sides for the floating Big Cube.
 */
function createFaeCliffSideTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#223b32');
  grad.addColorStop(0.1, '#1c2b2c');
  grad.addColorStop(0.55, '#151e28');
  grad.addColorStop(1, '#0d131c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Overhanging forest moss shelf along the top edge
  ctx.fillStyle = '#254236';
  ctx.fillRect(0, 0, size, 26);
  ctx.fillStyle = '#335a49';
  for (let x = 0; x < size; x += 22) {
    const drop = 10 + ((x * 13) % 18);
    ctx.fillRect(x, 22, 16, drop);
  }

  // Stratified stone ledges
  ctx.strokeStyle = 'rgba(120, 175, 165, 0.1)';
  ctx.lineWidth = 3;
  for (let j = 1; j < 6; j++) {
    const y = 52 + (j / 6) * (size - 52);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  // Subtle luminescent quartz mineral veins
  ctx.strokeStyle = 'rgba(125, 226, 214, 0.18)';
  ctx.lineWidth = 2;
  for (let v = 0; v < 5; v++) {
    const sx = 64 + v * 96;
    ctx.beginPath();
    ctx.moveTo(sx, 74);
    ctx.lineTo(sx + (v % 2 === 0 ? 18 : -16), 210);
    ctx.lineTo(sx + (v % 2 === 0 ? -8 : 12), 360);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function buildCubeWorld(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  isSoftwareGl: boolean
): WorldHandles {
  const disposables: Array<{ dispose: () => void }> = [];

  // Moonlit twilight Fae Forest atmosphere
  const skyColor = new THREE.Color(0x111a28);
  scene.background = skyColor;
  scene.fog = new THREE.FogExp2(0x111a28, 0.0135);

  // Studio environment reflections (PMREM RoomEnvironment) so Crystal Fae heads sparkle clearly in twilight
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envRT = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.62;
  pmremGenerator.dispose();
  disposables.push(envRT);

  // Balanced Moonlit Twilight 3-Point Rig (cool silver moon key, soft forest bounce, aquamarine rim)
  // Leaves generous dynamic range for the warm amber campfire PointLight at (0, 0, 0)
  const hemiLight = new THREE.HemisphereLight(0x6d93c4, 0x192922, 0.88);
  scene.add(hemiLight);

  const moonKeyLight = new THREE.DirectionalLight(0xbcd4ff, 1.25);
  moonKeyLight.position.set(16, 28, 14);
  if (!isSoftwareGl) {
    moonKeyLight.castShadow = true;
    moonKeyLight.shadow.mapSize.set(2048, 2048);
    moonKeyLight.shadow.camera.near = 4;
    moonKeyLight.shadow.camera.far = 72;
    const d = CUBE_HALF_SIZE + 5;
    moonKeyLight.shadow.camera.left = -d;
    moonKeyLight.shadow.camera.right = d;
    moonKeyLight.shadow.camera.top = d;
    moonKeyLight.shadow.camera.bottom = -d;
    moonKeyLight.shadow.bias = -0.0005;
    moonKeyLight.shadow.normalBias = 0.02;
  }
  scene.add(moonKeyLight);

  const faeRimLight = new THREE.DirectionalLight(0x7be0d6, 0.65);
  faeRimLight.position.set(-18, 12, -16);
  scene.add(faeRimLight);

  // THE BIG CUBE CLEARING (26 x 26 x 26 floating mossy stone monument with top surface at y = 0)
  const floorCubeGroup = new THREE.Group();
  const fullSize = CUBE_HALF_SIZE * 2;
  const maxAniso = Math.max(1, renderer.capabilities.getMaxAnisotropy());

  const topTex = createFaeGladeTopTexture(maxAniso);
  const sideTex = createFaeCliffSideTexture(maxAniso);
  disposables.push(topTex, sideTex);

  const topMat = new THREE.MeshStandardMaterial({
    map: topTex,
    roughness: 0.86,
    metalness: 0.04,
  });
  const sideMat = new THREE.MeshStandardMaterial({
    map: sideTex,
    roughness: 0.78,
    metalness: 0.08,
  });
  const bottomMat = new THREE.MeshStandardMaterial({
    color: 0x0d131c,
    roughness: 0.9,
    metalness: 0.08,
  });
  disposables.push(topMat, sideMat, bottomMat);

  const cubeGeo = new THREE.BoxGeometry(fullSize, fullSize, fullSize);
  disposables.push(cubeGeo);

  const bigCubeMesh = new THREE.Mesh(cubeGeo, [
    sideMat,
    sideMat,
    topMat,
    bottomMat,
    sideMat,
    sideMat,
  ]);
  bigCubeMesh.position.y = -CUBE_HALF_SIZE;
  bigCubeMesh.receiveShadow = true;
  floorCubeGroup.add(bigCubeMesh);

  // ==================== FAE FOREST PERIMETER (TREES, QUARTZ CRYSTALS, GLOW MUSHROOMS) ====================
  // Placed cleanly outside the ceremonial ring (radius >= 10.7) so the dance circle & campfire stay open
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.34, 2.2, 5);
  const canopyBotGeo = new THREE.ConeGeometry(1.48, 2.4, 6);
  const canopyMidGeo = new THREE.ConeGeometry(1.12, 2.1, 6);
  const canopyTopGeo = new THREE.ConeGeometry(0.72, 1.7, 5);

  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x2b2024,
    roughness: 0.92,
    metalness: 0.04,
    flatShading: true,
  });
  const pineMatA = new THREE.MeshStandardMaterial({
    color: 0x1a3b38,
    roughness: 0.82,
    metalness: 0.06,
    flatShading: true,
  });
  const pineMatB = new THREE.MeshStandardMaterial({
    color: 0x214a44,
    roughness: 0.8,
    metalness: 0.08,
    flatShading: true,
  });
  disposables.push(trunkGeo, canopyBotGeo, canopyMidGeo, canopyTopGeo, trunkMat, pineMatA, pineMatB);

  const treeCoords: Array<[number, number, number]> = [
    [-11.2, -11.0, 1.18],
    [-6.2, -11.7, 0.92],
    [5.8, -11.8, 1.05],
    [11.3, -10.8, 1.24],
    [11.7, -4.6, 0.96],
    [11.6, 5.2, 1.08],
    [11.0, 11.2, 1.15],
    [4.8, 11.8, 0.88],
    [-5.4, 11.7, 1.02],
    [-11.1, 11.1, 1.22],
    [-11.7, 4.4, 0.95],
    [-11.8, -5.2, 1.06],
  ];

  treeCoords.forEach(([tx, tz, sc], idx) => {
    const tree = new THREE.Group();
    tree.position.set(tx, 0, tz);
    tree.scale.setScalar(sc);
    tree.rotation.y = idx * 1.1;

    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.05;
    trunk.castShadow = !isSoftwareGl;
    trunk.receiveShadow = true;
    tree.add(trunk);

    const mat = idx % 2 === 0 ? pineMatA : pineMatB;
    const c1 = new THREE.Mesh(canopyBotGeo, mat);
    c1.position.y = 2.65;
    c1.castShadow = !isSoftwareGl;
    tree.add(c1);

    const c2 = new THREE.Mesh(canopyMidGeo, mat);
    c2.position.y = 3.95;
    c2.rotation.y = 0.45;
    c2.castShadow = !isSoftwareGl;
    tree.add(c2);

    const c3 = new THREE.Mesh(canopyTopGeo, mat);
    c3.position.y = 5.05;
    c3.rotation.y = 0.9;
    c3.castShadow = !isSoftwareGl;
    tree.add(c3);

    floorCubeGroup.add(tree);
  });

  // Glowing Fae Quartz Crystal Clusters around the clearing rim
  const shardGeo = new THREE.OctahedronGeometry(0.32, 0);
  shardGeo.scale(0.62, 2.35, 0.62);
  const boulderGeo = new THREE.DodecahedronGeometry(0.55, 0);
  const boulderMat = new THREE.MeshStandardMaterial({
    color: 0x26323a,
    roughness: 0.9,
    metalness: 0.06,
    flatShading: true,
  });
  const crystalMatCyan = new THREE.MeshStandardMaterial({
    color: 0x8ef5eb,
    emissive: 0x3ecfc4,
    emissiveIntensity: 0.72,
    roughness: 0.16,
    metalness: 0.25,
    flatShading: true,
  });
  const crystalMatViolet = new THREE.MeshStandardMaterial({
    color: 0xd0a6ff,
    emissive: 0x8b5cf6,
    emissiveIntensity: 0.65,
    roughness: 0.18,
    metalness: 0.25,
    flatShading: true,
  });
  disposables.push(shardGeo, boulderGeo, boulderMat, crystalMatCyan, crystalMatViolet);

  const crystalSpots: Array<[number, number, number]> = [
    [-9.6, -9.8, 1.0],
    [9.8, -9.6, 1.15],
    [10.2, 9.5, 1.05],
    [-9.7, 9.9, 1.1],
    [0.4, -11.6, 0.95],
    [11.6, 0.3, 0.9],
    [-0.6, 11.6, 0.95],
    [-11.6, -0.4, 0.92],
  ];

  crystalSpots.forEach(([cx, cz, sc], idx) => {
    const cluster = new THREE.Group();
    cluster.position.set(cx, 0, cz);
    cluster.scale.setScalar(sc);

    const boulder = new THREE.Mesh(boulderGeo, boulderMat);
    boulder.position.y = 0.22;
    boulder.scale.set(1.2, 0.65, 1.1);
    boulder.rotation.y = idx * 0.8;
    cluster.add(boulder);

    const mat = idx % 2 === 0 ? crystalMatCyan : crystalMatViolet;
    for (let s = 0; s < 3; s++) {
      const shard = new THREE.Mesh(shardGeo, mat);
      const ang = (s / 3) * Math.PI * 2 + idx;
      shard.position.set(Math.cos(ang) * 0.24, 0.62 + (s === 0 ? 0.22 : 0), Math.sin(ang) * 0.24);
      shard.scale.setScalar(s === 0 ? 1.1 : 0.72);
      shard.rotation.set((s - 1) * 0.26, ang, (s === 1 ? -0.22 : 0.18));
      cluster.add(shard);
    }
    floorCubeGroup.add(cluster);
  });

  // Tiny Bioluminescent Forest Mushrooms nestled near the tree roots
  const stemGeo = new THREE.CylinderGeometry(0.05, 0.08, 0.32, 5);
  const capGeo = new THREE.ConeGeometry(0.24, 0.18, 6);
  const stemMat = new THREE.MeshStandardMaterial({
    color: 0xd8dfd6,
    roughness: 0.7,
    flatShading: true,
  });
  const capMatGlow = new THREE.MeshStandardMaterial({
    color: 0x7ef2d4,
    emissive: 0x38c9a8,
    emissiveIntensity: 0.75,
    roughness: 0.35,
    flatShading: true,
  });
  disposables.push(stemGeo, capGeo, stemMat, capMatGlow);

  const mushSpots: Array<[number, number, number]> = [
    [-10.2, -7.8, 1.0],
    [-8.1, -10.8, 0.85],
    [8.2, -10.6, 1.1],
    [10.6, -7.2, 0.8],
    [10.5, 7.6, 1.05],
    [7.4, 10.8, 0.85],
    [-7.6, 10.6, 1.15],
    [-10.6, 7.2, 0.9],
  ];
  mushSpots.forEach(([mx, mz, sc], idx) => {
    const grp = new THREE.Group();
    grp.position.set(mx, 0, mz);
    grp.scale.setScalar(sc);
    for (let k = 0; k < 2; k++) {
      const mStem = new THREE.Mesh(stemGeo, stemMat);
      mStem.position.set(k * 0.28, 0.16 * (k === 0 ? 1 : 0.72), k * -0.18);
      mStem.scale.setScalar(k === 0 ? 1 : 0.72);
      grp.add(mStem);

      const mCap = new THREE.Mesh(capGeo, capMatGlow);
      mCap.position.set(k * 0.28, 0.34 * (k === 0 ? 1 : 0.74), k * -0.18);
      mCap.scale.setScalar(k === 0 ? 1 : 0.72);
      mCap.rotation.z = (idx % 2 === 0 ? 1 : -1) * 0.12;
      grp.add(mCap);
    }
    floorCubeGroup.add(grp);
  });

  scene.add(floorCubeGroup);

  // ==================== FLOATING FAE FOREST FIREFLIES ====================
  const fireflies: FireflyMote[] = [];
  const moteGeo = new THREE.OctahedronGeometry(0.055, 0);
  const moteMatGold = new THREE.MeshBasicMaterial({
    color: 0xffe49e,
    transparent: true,
    opacity: 0.82,
  });
  const moteMatMint = new THREE.MeshBasicMaterial({
    color: 0x8efae8,
    transparent: true,
    opacity: 0.78,
  });
  disposables.push(moteGeo, moteMatGold, moteMatMint);

  for (let i = 0; i < 36; i++) {
    const mesh = new THREE.Mesh(moteGeo, i % 2 === 0 ? moteMatGold : moteMatMint);
    const baseAngle = (i / 36) * Math.PI * 2 + (i % 5) * 0.23;
    const radius = 5.5 + (i % 7) * 1.15;
    const baseY = 1.2 + (i % 6) * 0.85;
    mesh.position.set(Math.cos(baseAngle) * radius, baseY, Math.sin(baseAngle) * radius);
    scene.add(mesh);
    fireflies.push({
      mesh,
      baseAngle,
      radius,
      baseY,
      speed: (i % 2 === 0 ? 1 : -1) * (0.04 + (i % 4) * 0.018),
      bobSpeed: 0.9 + (i % 5) * 0.32,
      phase: i * 1.37,
    });
  }

  // Distant silhouetted twilight crystal forest spires in the misty horizon
  const horizonMonoliths = new THREE.Group();
  const spireGeo = new THREE.ConeGeometry(2.4, 14, 5);
  const spireMat = new THREE.MeshStandardMaterial({
    color: 0x162436,
    roughness: 0.85,
    metalness: 0.12,
    flatShading: true,
  });
  disposables.push(spireGeo, spireMat);

  const spireCoords: Array<[number, number, number, number]> = [
    [-38, 2, -34, 1.3],
    [42, -1, -30, 1.1],
    [36, 4, 38, 1.45],
    [-42, -3, 34, 1.15],
    [2, 6, -48, 1.7],
    [-26, -6, -46, 0.95],
    [24, -4, 46, 1.05],
  ];

  for (const [mx, my, mz, sc] of spireCoords) {
    const m = new THREE.Mesh(spireGeo, spireMat);
    m.position.set(mx, my, mz);
    m.scale.setScalar(sc);
    m.rotation.set(0.06, mx * 0.1, -0.05);
    horizonMonoliths.add(m);
  }
  scene.add(horizonMonoliths);

  const updateAmbient = (dt: number, elapsedSec: number, beatPulse: number): void => {
    horizonMonoliths.rotation.y += dt * 0.008;

    // Gentle bioluminescent quartz crystal & mushroom breathing in time with the forest music
    crystalMatCyan.emissiveIntensity = 0.62 + beatPulse * 0.32;
    crystalMatViolet.emissiveIntensity = 0.56 + beatPulse * 0.34;
    capMatGlow.emissiveIntensity = 0.65 + beatPulse * 0.28;

    for (const f of fireflies) {
      const ang = f.baseAngle + elapsedSec * f.speed;
      const r = f.radius + Math.sin(elapsedSec * 0.6 + f.phase) * 0.55;
      const y = f.baseY + Math.sin(elapsedSec * f.bobSpeed + f.phase) * 0.45;
      f.mesh.position.set(Math.cos(ang) * r, y, Math.sin(ang) * r);
      const pulse = 0.65 + 0.45 * Math.sin(elapsedSec * 3.1 + f.phase) + beatPulse * 0.25;
      f.mesh.scale.setScalar(pulse);
    }
  };

  return {
    floorCubeGroup,
    horizonMonoliths,
    updateAmbient,
    disposables,
  };
}
