import * as THREE from 'three';
import { AudioBands, MusicalClock } from '../audio/soundEngine';
import { DEFAULT_HOLONOMY, HolonomyConfig } from '../shared/beatSchema';

interface CurvatureWellMesh {
  group: THREE.Group;
  spire: THREE.Mesh;
  spireMat: THREE.MeshStandardMaterial;
  halo: THREE.Mesh;
  haloMat: THREE.MeshBasicMaterial;
  baseRing: THREE.Mesh;
  baseMat: THREE.MeshBasicMaterial;
  pulse: number;
}

const RING_SEGMENTS = 96;
const INNER_BASE_RADIUS = 7.45;
const OUTER_BASE_RADIUS = 9.2;
const PHASE_ARC_SEGMENTS = 64;
const PHASE_ARC_RADIUS = 4.65;

/**
 * Computes the warped radial geodesic coordinate at angle `theta` given the holonomy config.
 * Shared between the visual manifold rings and the marchers so Fae literally walk on the curved geodesics!
 */
export function sampleGeodesicRadius(
  baseRadius: number,
  angle: number,
  holonomy: HolonomyConfig
): number {
  if (!holonomy.enabled) return baseRadius;
  let r = baseRadius;
  const k = holonomy.curvature;
  if (Math.abs(k) > 0.005) {
    // Gentle trefoil / harmonic curvature lobe aligned with Drei Stars symmetry
    r += Math.sin(angle * 3) * k * 0.52 + Math.cos(angle * 2) * k * 0.24;
  }
  for (const well of holonomy.wells) {
    let dAng = angle - well.angle;
    while (dAng > Math.PI) dAng -= Math.PI * 2;
    while (dAng < -Math.PI) dAng += Math.PI * 2;
    const angularInfluence = Math.exp(-(dAng * dAng) / 0.28);
    const radialDist = Math.abs(baseRadius - well.radius);
    const radialInfluence = Math.exp(-(radialDist * radialDist) / 4.5);
    r += well.strength * 0.85 * angularInfluence * radialInfluence;
  }
  return Math.max(4.4, Math.min(12.2, r));
}

/**
 * Evaluates local Gaussian curvature density along an orbit at `(angle, radius)` to accumulate
 * Berry-phase holonomy angle Δθ smoothly as marchers walk closed loops around the campfire.
 */
export function evaluateLocalCurvature(
  angle: number,
  radius: number,
  holonomy: HolonomyConfig
): number {
  if (!holonomy.enabled) return 0;
  // Base uniform curvature K across the campfire disk -> encloses Berry phase proportional to K
  let density = holonomy.curvature;
  for (const well of holonomy.wells) {
    let dAng = angle - well.angle;
    while (dAng > Math.PI) dAng -= Math.PI * 2;
    while (dAng < -Math.PI) dAng += Math.PI * 2;
    const angularInfluence = Math.exp(-(dAng * dAng) / 0.22);
    const radialDist = Math.abs(radius - well.radius);
    const radialInfluence = Math.exp(-(radialDist * radialDist) / 3.8);
    density += well.strength * 2.4 * angularInfluence * radialInfluence;
  }
  return density;
}

/**
 * 3D Fae Forest Holonomy Manifold overlay:
 * - Warped geodesic orbit rings for inner drums & outer Drei Stars singers
 * - Live Berry-phase holonomy arc showing accumulated parallel-transport angle θ (mod 2π)
 * - Up to 4 composite crystalline curvature well nodes on the clearing floor
 */
export class HolonomyField {
  public readonly root = new THREE.Group();

  private innerRingGeo: THREE.BufferGeometry;
  private outerRingGeo: THREE.BufferGeometry;
  private innerRingMat: THREE.LineBasicMaterial;
  private outerRingMat: THREE.LineBasicMaterial;
  private innerRingLine: THREE.LineLoop;
  private outerRingLine: THREE.LineLoop;

  private phaseArcGeo: THREE.BufferGeometry;
  private phaseArcMat: THREE.LineBasicMaterial;
  private phaseArcLine: THREE.Line;
  private phaseNeedleMesh: THREE.Mesh;
  private phaseNeedleMat: THREE.MeshBasicMaterial;
  private phaseNeedleGeo: THREE.OctahedronGeometry;

  private wellSpireGeo: THREE.ConeGeometry;
  private wellHaloGeo: THREE.RingGeometry;
  private wellBaseGeo: THREE.RingGeometry;
  private wellMeshes: CurvatureWellMesh[] = [];

  private config: HolonomyConfig = { ...DEFAULT_HOLONOMY, wells: [] };
  private geometryDirty = true;

  constructor() {
    this.root.name = 'HolonomyManifold';

    // 1. Inner Drum Geodesic Ring & Outer Singer Geodesic Ring
    this.innerRingGeo = new THREE.BufferGeometry();
    this.innerRingGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(RING_SEGMENTS * 3), 3)
    );
    this.innerRingMat = new THREE.LineBasicMaterial({
      color: 0xffa064,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });
    this.innerRingLine = new THREE.LineLoop(this.innerRingGeo, this.innerRingMat);
    this.innerRingLine.position.y = 0.06;
    this.root.add(this.innerRingLine);

    this.outerRingGeo = new THREE.BufferGeometry();
    this.outerRingGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(RING_SEGMENTS * 3), 3)
    );
    this.outerRingMat = new THREE.LineBasicMaterial({
      color: 0x62e2d8,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    this.outerRingLine = new THREE.LineLoop(this.outerRingGeo, this.outerRingMat);
    this.outerRingLine.position.y = 0.07;
    this.root.add(this.outerRingLine);

    // 2. Live Parallel-Transport Berry Phase Arc around the hearth
    this.phaseArcGeo = new THREE.BufferGeometry();
    this.phaseArcGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array((PHASE_ARC_SEGMENTS + 1) * 3), 3)
    );
    this.phaseArcMat = new THREE.LineBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.phaseArcLine = new THREE.Line(this.phaseArcGeo, this.phaseArcMat);
    this.phaseArcLine.position.y = 0.08;
    this.root.add(this.phaseArcLine);

    this.phaseNeedleGeo = new THREE.OctahedronGeometry(0.16, 0);
    this.phaseNeedleMat = new THREE.MeshBasicMaterial({
      color: 0xf0abfc,
      transparent: true,
      opacity: 0.85,
    });
    this.phaseNeedleMesh = new THREE.Mesh(this.phaseNeedleGeo, this.phaseNeedleMat);
    this.phaseNeedleMesh.position.set(PHASE_ARC_RADIUS, 0.22, 0);
    this.root.add(this.phaseNeedleMesh);

    // 3. Shared geometries for up to 4 composite Curvature Well crystal nodes
    this.wellSpireGeo = new THREE.ConeGeometry(0.24, 0.82, 5);
    this.wellHaloGeo = new THREE.RingGeometry(0.45, 0.72, 24);
    this.wellBaseGeo = new THREE.RingGeometry(0.95, 1.06, 28);

    this.rebuildGeodesicRings();
  }

  public setConfig(next: HolonomyConfig): void {
    this.config = {
      ...next,
      wells: next.wells.map((w) => ({ ...w })),
    };
    this.geometryDirty = true;
    this.syncWellMeshes();
  }

  public pulseWell(wellIndex: number, strength = 1.0): void {
    const wm = this.wellMeshes[wellIndex];
    if (wm) {
      wm.pulse = Math.min(1.6, Math.max(wm.pulse, strength));
    }
  }

  private syncWellMeshes(): void {
    const needed = this.config.enabled ? this.config.wells.length : 0;

    while (this.wellMeshes.length > needed) {
      const removed = this.wellMeshes.pop()!;
      this.root.remove(removed.group);
      removed.spireMat.dispose();
      removed.haloMat.dispose();
      removed.baseMat.dispose();
    }

    while (this.wellMeshes.length < needed) {
      const group = new THREE.Group();

      const spireMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x7c3aed,
        emissiveIntensity: 0.75,
        roughness: 0.2,
        metalness: 0.35,
        flatShading: true,
      });
      const spire = new THREE.Mesh(this.wellSpireGeo, spireMat);
      spire.position.y = 0.44;
      group.add(spire);

      const haloMat = new THREE.MeshBasicMaterial({
        color: 0xa78bfa,
        transparent: true,
        opacity: 0.48,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const halo = new THREE.Mesh(this.wellHaloGeo, haloMat);
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.09;
      group.add(halo);

      const baseMat = new THREE.MeshBasicMaterial({
        color: 0x5eead4,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const baseRing = new THREE.Mesh(this.wellBaseGeo, baseMat);
      baseRing.rotation.x = -Math.PI / 2;
      baseRing.position.y = 0.08;
      group.add(baseRing);

      this.root.add(group);
      this.wellMeshes.push({ group, spire, spireMat, halo, haloMat, baseRing, baseMat, pulse: 0 });
    }

    for (let i = 0; i < needed; i++) {
      const well = this.config.wells[i];
      const wm = this.wellMeshes[i];
      const x = Math.cos(well.angle) * well.radius;
      const z = Math.sin(well.angle) * well.radius;
      wm.group.position.set(x, 0, z);
      const isPositive = well.strength >= 0;
      wm.spireMat.color.setHex(isPositive ? 0x5eead4 : 0xf472b6);
      wm.spireMat.emissive.setHex(isPositive ? 0x0d9488 : 0xbe185d);
      wm.haloMat.color.setHex(isPositive ? 0x5eead4 : 0xf472b6);
      wm.baseMat.color.setHex(isPositive ? 0xa78bfa : 0xfbbf24);
      const scale = 0.72 + Math.abs(well.strength) * 0.55;
      wm.spire.scale.set(scale, scale, scale);
    }
  }

  private rebuildGeodesicRings(): void {
    const innerPos = this.innerRingGeo.attributes.position as THREE.BufferAttribute;
    const outerPos = this.outerRingGeo.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < RING_SEGMENTS; i++) {
      const ang = (i / RING_SEGMENTS) * Math.PI * 2;
      const rIn = sampleGeodesicRadius(INNER_BASE_RADIUS, ang, this.config);
      const rOut = sampleGeodesicRadius(OUTER_BASE_RADIUS, ang, this.config);
      innerPos.setXYZ(i, Math.cos(ang) * rIn, 0, Math.sin(ang) * rIn);
      outerPos.setXYZ(i, Math.cos(ang) * rOut, 0, Math.sin(ang) * rOut);
    }
    innerPos.needsUpdate = true;
    outerPos.needsUpdate = true;
    this.geometryDirty = false;
  }

  public update(
    elapsedSec: number,
    dt: number,
    globalThetaRad: number,
    audio: AudioBands,
    clock: MusicalClock
  ): void {
    if (this.geometryDirty) {
      this.rebuildGeodesicRings();
    }

    const activeCurvature =
      this.config.enabled && (Math.abs(this.config.curvature) > 0.01 || this.config.wells.length > 0);
    const fooofBoost = clock.campfireBeat === 7 ? 0.25 : 0;

    this.innerRingMat.opacity = activeCurvature ? 0.28 + audio.bass * 0.2 + fooofBoost : 0.1;
    this.outerRingMat.opacity = activeCurvature ? 0.34 + audio.treble * 0.22 + fooofBoost : 0.12;

    // Update parallel-transport phase arc (wrapped smoothly 0..2π)
    const wrapped = ((globalThetaRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const arcVisible = activeCurvature && wrapped > 0.03;
    this.phaseArcLine.visible = arcVisible;
    this.phaseNeedleMesh.visible = activeCurvature;

    if (activeCurvature) {
      const arcPos = this.phaseArcGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i <= PHASE_ARC_SEGMENTS; i++) {
        const a = (i / PHASE_ARC_SEGMENTS) * wrapped;
        arcPos.setXYZ(i, Math.cos(a) * PHASE_ARC_RADIUS, 0, Math.sin(a) * PHASE_ARC_RADIUS);
      }
      arcPos.needsUpdate = true;
      this.phaseArcMat.opacity = 0.42 + audio.beatPulse * 0.3;

      this.phaseNeedleMesh.position.set(
        Math.cos(wrapped) * PHASE_ARC_RADIUS,
        0.24 + Math.sin(elapsedSec * 4) * 0.05,
        Math.sin(wrapped) * PHASE_ARC_RADIUS
      );
      this.phaseNeedleMesh.rotation.y = elapsedSec * 2.2;
      this.phaseNeedleMesh.rotation.x = wrapped;
      this.phaseNeedleMat.opacity = 0.75 + audio.beatPulse * 0.25;
    }

    // Animate curvature well crystal nodes
    for (let i = 0; i < this.wellMeshes.length; i++) {
      const wm = this.wellMeshes[i];
      wm.pulse = Math.max(0, wm.pulse - dt * 2.2);
      const breath = 1 + Math.sin(elapsedSec * 2.6 + i * 1.4) * 0.08 + wm.pulse * 0.35 + audio.beatPulse * 0.1;
      wm.spire.rotation.y = elapsedSec * 1.1 + i;
      wm.spire.position.y = 0.44 + Math.sin(elapsedSec * 2.4 + i) * 0.06 + wm.pulse * 0.14;
      wm.spireMat.emissiveIntensity = 0.65 + wm.pulse * 1.1 + audio.beatPulse * 0.3;
      wm.halo.scale.setScalar(breath);
      wm.haloMat.opacity = Math.min(0.9, 0.36 + wm.pulse * 0.45 + audio.beatPulse * 0.15);
      wm.baseRing.scale.setScalar(1 + wm.pulse * 0.42);
      wm.baseMat.opacity = Math.min(0.75, 0.25 + wm.pulse * 0.4);
    }
  }

  public dispose(): void {
    this.innerRingGeo.dispose();
    this.outerRingGeo.dispose();
    this.innerRingMat.dispose();
    this.outerRingMat.dispose();
    this.phaseArcGeo.dispose();
    this.phaseArcMat.dispose();
    this.phaseNeedleGeo.dispose();
    this.phaseNeedleMat.dispose();
    this.wellSpireGeo.dispose();
    this.wellHaloGeo.dispose();
    this.wellBaseGeo.dispose();
    for (const wm of this.wellMeshes) {
      wm.spireMat.dispose();
      wm.haloMat.dispose();
      wm.baseMat.dispose();
    }
    this.wellMeshes = [];
  }
}
