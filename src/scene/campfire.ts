import * as THREE from 'three';
import { AudioBands, MusicalClock } from '../audio/soundEngine';

interface EmberParticle {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  maxLife: number;
  swirlPhase: number;
  swirlRadius: number;
  baseScale: number;
  isSparkle: boolean;
}

export class MusicalCampfire {
  public readonly root: THREE.Group;
  private readonly fireLight: THREE.PointLight;
  private readonly emberBedMat: THREE.MeshStandardMaterial;
  private readonly innerFlame: THREE.Mesh;
  private readonly innerFlameMat: THREE.MeshBasicMaterial;
  private readonly midFlames: THREE.Mesh[] = [];
  private readonly midFlameMats: THREE.MeshBasicMaterial[] = [];
  private readonly outerFlames: THREE.Mesh[] = [];
  private readonly outerFlameMats: THREE.MeshBasicMaterial[] = [];
  private readonly fooofHalo: THREE.Mesh;
  private readonly fooofHaloMat: THREE.MeshBasicMaterial;

  private readonly embers: EmberParticle[] = [];
  private readonly disposables: Array<{ dispose: () => void }> = [];

  private lastBeatSeen = -1;
  private bumpEnvelope = 0; // 0..1 crisp beat bump
  private fooofEnvelope = 0; // 0..1 beat-8 FOOOF! bloom
  private ambientEmberTimer = 0;

  constructor(isSoftwareGl: boolean) {
    this.root = new THREE.Group();

    // 1. Dark basalt hearth base & glowing coal bed at (0, 0, 0)
    const ashGeo = new THREE.CylinderGeometry(1.18, 1.32, 0.14, 10);
    const ashMat = new THREE.MeshStandardMaterial({
      color: 0x1a171c,
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true,
    });
    const ashMesh = new THREE.Mesh(ashGeo, ashMat);
    ashMesh.position.y = 0.06;
    ashMesh.receiveShadow = true;
    this.root.add(ashMesh);
    this.disposables.push(ashGeo, ashMat);

    const emberBedGeo = new THREE.CylinderGeometry(0.76, 0.92, 0.16, 9);
    this.emberBedMat = new THREE.MeshStandardMaterial({
      color: 0x3b180e,
      emissive: 0xff5a18,
      emissiveIntensity: 1.05,
      roughness: 0.8,
      metalness: 0.1,
      flatShading: true,
    });
    const emberBed = new THREE.Mesh(emberBedGeo, this.emberBedMat);
    emberBed.position.y = 0.12;
    this.root.add(emberBed);
    this.disposables.push(emberBedGeo, this.emberBedMat);

    // 2. Ring of 10 faceted mossy hearth stones
    const stoneGeo = new THREE.DodecahedronGeometry(0.32, 0);
    const stoneMatA = new THREE.MeshStandardMaterial({
      color: 0x38424a,
      roughness: 0.88,
      metalness: 0.06,
      flatShading: true,
    });
    const stoneMatB = new THREE.MeshStandardMaterial({
      color: 0x2c3c36,
      roughness: 0.9,
      metalness: 0.04,
      flatShading: true,
    });
    this.disposables.push(stoneGeo, stoneMatA, stoneMatB);

    const stoneCount = 10;
    for (let i = 0; i < stoneCount; i++) {
      const ang = (i / stoneCount) * Math.PI * 2 + (i % 2) * 0.08;
      const r = 1.15 + (i % 3) * 0.04;
      const stone = new THREE.Mesh(stoneGeo, i % 3 === 0 ? stoneMatB : stoneMatA);
      stone.position.set(Math.cos(ang) * r, 0.18 + (i % 2) * 0.04, Math.sin(ang) * r);
      stone.scale.set(1.05 + (i % 3) * 0.16, 0.68 + (i % 2) * 0.18, 0.92 + ((i + 1) % 3) * 0.12);
      stone.rotation.set(i * 0.7, ang, i * 0.4);
      stone.castShadow = !isSoftwareGl;
      stone.receiveShadow = true;
      this.root.add(stone);
    }

    // 3. 4 crossed charred forest logs over the coals
    const logGeo = new THREE.CylinderGeometry(0.11, 0.14, 1.48, 6);
    const logMat = new THREE.MeshStandardMaterial({
      color: 0x2a1d17,
      emissive: 0x451408,
      emissiveIntensity: 0.35,
      roughness: 0.92,
      metalness: 0.05,
      flatShading: true,
    });
    this.disposables.push(logGeo, logMat);

    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + 0.35;
      const log = new THREE.Mesh(logGeo, logMat);
      log.position.set(Math.cos(ang) * 0.28, 0.34, Math.sin(ang) * 0.28);
      log.rotation.order = 'YXZ';
      log.rotation.y = ang;
      log.rotation.x = 1.12;
      log.castShadow = !isSoftwareGl;
      this.root.add(log);
    }

    // 4. Layered low-poly sculpted flames (inner white-gold, mid amber, outer coral-rose tips)
    const innerGeo = new THREE.OctahedronGeometry(0.36, 0);
    innerGeo.scale(0.85, 1.85, 0.85);
    innerGeo.translate(0, 0.55, 0);
    this.innerFlameMat = new THREE.MeshBasicMaterial({
      color: 0xfff0b8,
      transparent: true,
      opacity: 0.94,
    });
    this.innerFlame = new THREE.Mesh(innerGeo, this.innerFlameMat);
    this.innerFlame.position.set(0, 0.22, 0);
    this.innerFlame.renderOrder = 8;
    this.root.add(this.innerFlame);
    this.disposables.push(innerGeo, this.innerFlameMat);

    const midGeo = new THREE.ConeGeometry(0.36, 1.38, 5);
    midGeo.translate(0, 0.68, 0);
    this.disposables.push(midGeo);

    const midSpecs = [
      { x: 0.16, z: 0.12, rotY: 0.4, tilt: 0.12, color: 0xff922b },
      { x: -0.18, z: 0.08, rotY: 2.3, tilt: -0.14, color: 0xff7b24 },
      { x: 0.02, z: -0.18, rotY: 4.1, tilt: 0.1, color: 0xffaa3b },
    ];
    for (const sp of midSpecs) {
      const mat = new THREE.MeshBasicMaterial({
        color: sp.color,
        transparent: true,
        opacity: 0.84,
      });
      const mesh = new THREE.Mesh(midGeo, mat);
      mesh.position.set(sp.x, 0.24, sp.z);
      mesh.rotation.set(sp.tilt, sp.rotY, sp.tilt * 0.6);
      mesh.renderOrder = 7;
      this.root.add(mesh);
      this.midFlames.push(mesh);
      this.midFlameMats.push(mat);
      this.disposables.push(mat);
    }

    const outerGeo = new THREE.ConeGeometry(0.24, 1.65, 4);
    outerGeo.translate(0, 0.82, 0);
    this.disposables.push(outerGeo);

    const outerSpecs = [
      { x: 0.1, z: -0.1, rotY: 1.1, color: 0xff5436 },
      { x: -0.11, z: 0.11, rotY: 3.8, color: 0xff6b52 },
    ];
    for (const sp of outerSpecs) {
      const mat = new THREE.MeshBasicMaterial({
        color: sp.color,
        transparent: true,
        opacity: 0.62,
      });
      const mesh = new THREE.Mesh(outerGeo, mat);
      mesh.position.set(sp.x, 0.28, sp.z);
      mesh.rotation.y = sp.rotY;
      mesh.renderOrder = 6;
      this.root.add(mesh);
      this.outerFlames.push(mesh);
      this.outerFlameMats.push(mat);
      this.disposables.push(mat);
    }

    // 5. Subtle warm FOOOF! hearth ring bloom on beat 8
    const haloGeo = new THREE.RingGeometry(0.95, 1.65, 28);
    this.fooofHaloMat = new THREE.MeshBasicMaterial({
      color: 0xffb347,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.fooofHalo = new THREE.Mesh(haloGeo, this.fooofHaloMat);
    this.fooofHalo.rotation.x = -Math.PI / 2;
    this.fooofHalo.position.y = 0.06;
    this.fooofHalo.visible = false;
    this.fooofHalo.renderOrder = 4;
    this.root.add(this.fooofHalo);
    this.disposables.push(haloGeo, this.fooofHaloMat);

    // 6. Warm dancing hearth PointLight casting amber glow across the Crystal Fae circle
    this.fireLight = new THREE.PointLight(0xff8c3a, 14, 26, 1.45);
    this.fireLight.position.set(0, 1.45, 0);
    this.root.add(this.fireLight);

    // 7. Pre-allocated ember & golden sparkle pool (zero GC during animation)
    const emberGeo = new THREE.OctahedronGeometry(0.065, 0);
    this.disposables.push(emberGeo);

    const poolSize = 48;
    for (let i = 0; i < poolSize; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd166,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(emberGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 9;
      this.root.add(mesh);
      this.disposables.push(mat);

      this.embers.push({
        mesh,
        mat,
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        maxLife: 1,
        swirlPhase: 0,
        swirlRadius: 0,
        baseScale: 1,
        isSparkle: false,
      });
    }
  }

  private spawnEmbers(count: number, isFooof: boolean, accentBump: boolean): void {
    let spawned = 0;
    for (const p of this.embers) {
      if (p.active) continue;
      const ang = Math.random() * Math.PI * 2;
      const startR = Math.random() * (isFooof ? 0.55 : 0.34);

      p.active = true;
      p.age = 0;
      p.maxLife = isFooof ? 1.15 + Math.random() * 0.85 : 0.75 + Math.random() * 0.65;
      p.x = Math.cos(ang) * startR;
      p.y = 0.55 + Math.random() * 0.5;
      p.z = Math.sin(ang) * startR;

      const radial = isFooof ? 0.9 + Math.random() * 1.4 : accentBump ? 0.45 + Math.random() * 0.6 : 0.25 + Math.random() * 0.4;
      p.vx = Math.cos(ang) * radial;
      p.vy = isFooof ? 3.2 + Math.random() * 2.4 : accentBump ? 2.1 + Math.random() * 1.2 : 1.35 + Math.random() * 0.95;
      p.vz = Math.sin(ang) * radial;
      p.swirlPhase = Math.random() * Math.PI * 2;
      p.swirlRadius = isFooof ? 0.42 + Math.random() * 0.35 : 0.16 + Math.random() * 0.18;
      p.isSparkle = isFooof && Math.random() > 0.35;
      p.baseScale = p.isSparkle ? 1.15 + Math.random() * 0.65 : 0.62 + Math.random() * 0.45;

      // Tasteful golden-amber to soft-fae-rose palette
      if (p.isSparkle) {
        p.mat.color.setHex(Math.random() > 0.35 ? 0xffe699 : 0xffb35c);
      } else {
        p.mat.color.setHex(Math.random() > 0.4 ? 0xff9238 : 0xff5f38);
      }
      p.mesh.visible = true;

      spawned++;
      if (spawned >= count) break;
    }
  }

  /**
   * Exact 8-beat campfire rhythm:
   *   Beats 0, 1, 2 (1..3): bump.......bump.......bump.....
   *   Beat  3       (4):    BUMP...
   *   Beats 4, 5, 6 (5..7): bump.....bump.....bump.......
   *   Beat  7       (8):    FOOOF! (lush bloom + tasteful golden sparkles)
   */
  public update(elapsedSec: number, dt: number, audio: AudioBands, clock: MusicalClock): void {
    // Detect exact musical beat edge
    if (clock.totalBeats !== this.lastBeatSeen) {
      this.lastBeatSeen = clock.totalBeats;
      const beat8 = clock.campfireBeat; // 0..7

      if (beat8 === 7) {
        // Beat 8: FOOOF!
        this.fooofEnvelope = 1.0;
        this.bumpEnvelope = 0.9;
        this.spawnEmbers(18, true, false);
      } else if (beat8 === 3) {
        // Beat 4: BUMP!
        this.bumpEnvelope = 0.82;
        this.spawnEmbers(5, false, true);
      } else {
        // Beats 1, 2, 3, 5, 6, 7: bump
        this.bumpEnvelope = 0.42;
        this.spawnEmbers(2, false, false);
      }
    }

    // Gentle organic ambient crackle embers between beats (subtle, never overboard)
    this.ambientEmberTimer += dt;
    if (this.ambientEmberTimer > 0.34) {
      this.ambientEmberTimer = 0;
      this.spawnEmbers(1, false, false);
    }

    // Smooth physical decay of bump & FOOOF! envelopes
    this.bumpEnvelope = Math.max(0, this.bumpEnvelope - dt * 2.9);
    this.fooofEnvelope = Math.max(0, this.fooofEnvelope - dt * 1.45);

    const musicLift = audio.bass * 0.25 + audio.overall * 0.16;
    const flicker =
      Math.sin(elapsedSec * 14.5) * 0.045 + Math.cos(elapsedSec * 23.0) * 0.028;

    const totalHeightBoost = 1 + this.bumpEnvelope * 0.52 + this.fooofEnvelope * 1.05 + musicLift + flicker;
    const totalWidthBoost = 1 + this.bumpEnvelope * 0.2 + this.fooofEnvelope * 0.42 - flicker * 0.5;

    // 1. Inner white-gold core flame
    this.innerFlame.scale.set(
      totalWidthBoost * 0.94,
      totalHeightBoost * 1.02,
      totalWidthBoost * 0.94
    );
    this.innerFlame.rotation.y = elapsedSec * 1.6;
    this.innerFlameMat.opacity = Math.min(1, 0.88 + this.fooofEnvelope * 0.12);

    // 2. Mid amber flame tongues
    for (let i = 0; i < this.midFlames.length; i++) {
      const m = this.midFlames[i];
      const sway = Math.sin(elapsedSec * (6.8 + i * 1.7) + i * 2.1);
      const localH = totalHeightBoost * (0.9 + (i % 2) * 0.14 + Math.abs(sway) * 0.12);
      const localW = totalWidthBoost * (0.94 + Math.cos(elapsedSec * 8 + i) * 0.06);
      m.scale.set(localW, localH, localW);
      m.rotation.z = sway * (0.12 + this.fooofEnvelope * 0.12);
      m.rotation.y += dt * (0.9 + i * 0.3);
    }

    // 3. Outer coral-rose tips (bloom gracefully on BUMP and FOOOF!)
    for (let i = 0; i < this.outerFlames.length; i++) {
      const m = this.outerFlames[i];
      const sway = Math.cos(elapsedSec * (5.6 + i * 2.1) + i * 3.0);
      const outerH = totalHeightBoost * (0.88 + this.fooofEnvelope * 0.35);
      m.scale.set(totalWidthBoost * 0.95, outerH, totalWidthBoost * 0.95);
      m.rotation.z = sway * 0.16;
      m.rotation.x = Math.sin(elapsedSec * 4.5 + i) * 0.12;
      this.outerFlameMats[i].opacity = Math.min(0.88, 0.5 + this.bumpEnvelope * 0.2 + this.fooofEnvelope * 0.32);
    }

    // 4. FOOOF! warm ground shimmer ring on beat 8
    if (this.fooofEnvelope > 0.03) {
      this.fooofHalo.visible = true;
      const p = 1 - this.fooofEnvelope;
      const ringScale = 0.85 + p * 2.35;
      this.fooofHalo.scale.setScalar(ringScale);
      this.fooofHaloMat.opacity = this.fooofEnvelope * 0.42;
    } else {
      this.fooofHalo.visible = false;
    }

    // 5. Glowing ember coal bed + warm dancing hearth light
    this.emberBedMat.emissiveIntensity =
      0.95 + this.bumpEnvelope * 0.85 + this.fooofEnvelope * 1.45 + flicker * 2.2;

    this.fireLight.intensity =
      12.5 +
      this.bumpEnvelope * 8.5 +
      this.fooofEnvelope * 18.0 +
      musicLift * 4.0 +
      Math.sin(elapsedSec * 17) * 1.1;
    this.fireLight.position.y = 1.35 + this.bumpEnvelope * 0.25 + this.fooofEnvelope * 0.65;

    // 6. Update active embers & FOOOF! sparkles
    for (const p of this.embers) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.maxLife) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }

      const t = p.age / p.maxLife;
      const swirlX = Math.cos(elapsedSec * 4.2 + p.swirlPhase) * p.swirlRadius * dt * 2.4;
      const swirlZ = Math.sin(elapsedSec * 4.2 + p.swirlPhase) * p.swirlRadius * dt * 2.4;

      p.x += p.vx * dt + swirlX;
      p.y += p.vy * dt;
      p.z += p.vz * dt + swirlZ;
      p.vx *= 1 - dt * 1.25;
      p.vz *= 1 - dt * 1.25;
      p.vy *= 1 - dt * 0.38;

      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.rotation.x += dt * 5.5;
      p.mesh.rotation.y += dt * 7.2;

      const fade = t < 0.15 ? t / 0.15 : Math.pow(1 - (t - 0.15) / 0.85, 1.4);
      const twinkle = p.isSparkle ? 0.72 + 0.38 * Math.sin(elapsedSec * 22 + p.swirlPhase) : 1;
      const sc = Math.max(0.01, p.baseScale * fade * twinkle);
      p.mesh.scale.setScalar(sc);
      p.mat.opacity = Math.min(0.95, fade * twinkle);
    }
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
