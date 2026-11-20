import * as THREE from 'three';
import { AudioBands, MusicalClock } from '../audio/soundEngine';
import { DREI_STAR_HUES, SingerRole } from '../shared/beatSchema';

interface CelestialStar {
  role: SingerRole;
  group: THREE.Group;
  coreMesh: THREE.Mesh;
  spikeMesh: THREE.Mesh;
  haloMesh: THREE.Mesh;
  coreMat: THREE.MeshStandardMaterial;
  haloMat: THREE.MeshBasicMaterial;
  baseAngle: number;
  pulse: number;
  baseHue: number;
}

/**
 * DREI STARS — Three celestial faceted harmonic stars crowning the moonlit Fae Forest clearing.
 * Each star is linked to one of the three harmonic singer voices:
 * - Star I  (Gold, 38°):    Bass Singer
 * - Star II (Aqua, 176°):   Melody Singer
 * - Star III (Violet, 278°): Harmony Singer
 *
 * Connected by a delicate rotating celestial triangle filament above the campfire,
 * pulsing whenever its singer sings and blooming together on Beat-8 FOOOF! & 8-bar breaks.
 */
export class DreiStars {
  public readonly root: THREE.Group;

  private stars: CelestialStar[] = [];
  private starByRole: Record<SingerRole, CelestialStar>;
  private triangleLine: THREE.LineLoop;
  private trianglePositions: Float32Array;
  private triangleMat: THREE.LineBasicMaterial;
  private disposables: Array<{ dispose: () => void }> = [];

  constructor() {
    this.root = new THREE.Group();
    this.root.position.set(0, 7.6, 0);

    const coreGeo = new THREE.OctahedronGeometry(0.42, 0);
    const spikeGeo = new THREE.OctahedronGeometry(0.56, 0);
    spikeGeo.scale(0.52, 1.38, 0.52);
    const haloGeo = new THREE.TorusGeometry(0.76, 0.022, 6, 32);
    this.disposables.push(coreGeo, spikeGeo, haloGeo);

    const roles: SingerRole[] = ['bass', 'melody', 'harmony'];
    const map = {} as Record<SingerRole, CelestialStar>;

    roles.forEach((role, idx) => {
      const hue = DREI_STAR_HUES[role];
      const baseAngle = (idx / 3) * Math.PI * 2;
      const group = new THREE.Group();

      const coreMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(hue / 360, 0.9, 0.78),
        emissive: new THREE.Color().setHSL(hue / 360, 0.92, 0.56),
        emissiveIntensity: 1.15,
        roughness: 0.14,
        metalness: 0.35,
        flatShading: true,
      });

      const haloMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(hue / 360, 0.92, 0.72),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
      this.disposables.push(coreMat, haloMat);

      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      const spikeMesh = new THREE.Mesh(spikeGeo, coreMat);
      spikeMesh.rotation.z = Math.PI / 4;

      const crossSpike = new THREE.Mesh(spikeGeo, coreMat);
      crossSpike.rotation.z = -Math.PI / 4;
      crossSpike.rotation.y = Math.PI / 2;

      const haloMesh = new THREE.Mesh(haloGeo, haloMat);
      haloMesh.rotation.x = Math.PI / 2.3;

      group.add(coreMesh, spikeMesh, crossSpike, haloMesh);
      this.root.add(group);

      const star: CelestialStar = {
        role,
        group,
        coreMesh,
        spikeMesh,
        haloMesh,
        coreMat,
        haloMat,
        baseAngle,
        pulse: 0,
        baseHue: hue,
      };
      this.stars.push(star);
      map[role] = star;
    });

    this.starByRole = map;

    // Delicate luminous triangle connecting the Drei Stars
    this.trianglePositions = new Float32Array(3 * 3);
    const triGeo = new THREE.BufferGeometry();
    triGeo.setAttribute('position', new THREE.BufferAttribute(this.trianglePositions, 3));
    this.triangleMat = new THREE.LineBasicMaterial({
      color: 0xbfe7ff,
      transparent: true,
      opacity: 0.28,
    });
    this.disposables.push(triGeo, this.triangleMat);

    this.triangleLine = new THREE.LineLoop(triGeo, this.triangleMat);
    this.root.add(this.triangleLine);
  }

  public pulseStar(role: SingerRole, strength = 1.0): void {
    const star = this.starByRole[role];
    if (!star) return;
    star.pulse = Math.max(star.pulse, Math.min(1.5, strength));
  }

  public update(
    elapsedSec: number,
    dt: number,
    audio: AudioBands,
    clock: MusicalClock,
    dropUrgency = 0
  ): void {
    const isFooof = clock.campfireBeat === 7;
    const fooofLift = isFooof ? Math.sin(Math.min(1, clock.beatPhase * 1.6) * Math.PI) : 0;
    const breakLift = clock.isBreakBar ? Math.sin(clock.breakProgress * Math.PI) : 0;
    const dropPulse = dropUrgency > 0.01 ? dropUrgency * (0.5 + 0.5 * Math.sin(elapsedSec * (5 + dropUrgency * 8))) : 0;

    // Gentle BPM-linked constellation rotation (accelerates subtly when a Bar-8 drop is queued)
    const orbitBase = clock.exactBeats * (0.14 + dropUrgency * 0.12);
    const radius = 3.55 + fooofLift * 0.42 + breakLift * 0.55 - dropUrgency * 0.32;

    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      s.pulse = Math.max(0, s.pulse - dt * 2.8);

      const ang = s.baseAngle + orbitBase;
      const sx = Math.cos(ang) * radius;
      const sy = Math.sin(elapsedSec * 1.15 + i * 2.1) * 0.34 + fooofLift * 0.35 + s.pulse * 0.22 + dropPulse * 0.2;
      const sz = Math.sin(ang) * radius;

      s.group.position.set(sx, sy, sz);
      this.trianglePositions[i * 3] = sx;
      this.trianglePositions[i * 3 + 1] = sy;
      this.trianglePositions[i * 3 + 2] = sz;

      const scale = 0.92 + s.pulse * 0.42 + fooofLift * 0.26 + audio.beatPulse * 0.1 + dropPulse * 0.24;
      s.group.scale.setScalar(scale);

      s.coreMesh.rotation.y = elapsedSec * (0.9 + i * 0.2) + s.pulse * 1.6;
      s.coreMesh.rotation.x = elapsedSec * 0.55;
      s.haloMesh.rotation.z = elapsedSec * (1.1 + i * 0.25);
      s.haloMesh.rotation.x = Math.PI / 2.3 + Math.sin(elapsedSec * 0.8 + i) * 0.32;

      s.coreMat.emissiveIntensity = 1.0 + s.pulse * 1.85 + fooofLift * 0.95 + breakLift * 0.7 + dropPulse * 1.25;
      s.haloMat.opacity = Math.min(0.95, 0.38 + s.pulse * 0.5 + fooofLift * 0.3 + dropPulse * 0.35);
    }

    const posAttr = this.triangleLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    this.triangleMat.color.setHex(dropUrgency > 0.05 ? 0xfbbf24 : 0xbfe7ff);
    this.triangleMat.opacity = Math.min(
      0.92,
      0.22 + fooofLift * 0.35 + breakLift * 0.25 + audio.beatPulse * 0.12 + dropPulse * 0.45
    );
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
