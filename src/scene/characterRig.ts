import * as THREE from 'three';
import { AudioBands, MusicalClock } from '../audio/soundEngine';
import { DREI_STAR_HUES, InstrumentRole, isSingerRole } from '../shared/beatSchema';
import { BrainShapeKind, CharacterState, KolmogorovBrain } from '../shared/protocol';

interface SharedRigGeometries {
  clearCube: THREE.BoxGeometry;
  clearCubeEdges: THREE.EdgesGeometry;
  cornerDot: THREE.OctahedronGeometry;
  torso: THREE.BufferGeometry;
  collar: THREE.BufferGeometry;
  chestEmblem: THREE.OctahedronGeometry;
  shoulder: THREE.ConeGeometry;
  upperArm: THREE.ConeGeometry;
  hand: THREE.TetrahedronGeometry;
  pelvis: THREE.CylinderGeometry;
  leg: THREE.ConeGeometry;
  boot: THREE.BufferGeometry;
  faeWingUpper: THREE.BufferGeometry;
  faeWingLower: THREE.BufferGeometry;
  antenna: THREE.ConeGeometry;
  visorChevron: THREE.BufferGeometry;
  shadowDisc: THREE.CircleGeometry;
  stageRing: THREE.RingGeometry;
  vfxWaveRing: THREE.RingGeometry;
  starCrown: THREE.OctahedronGeometry;
  drumHalo: THREE.TorusGeometry;
  eqBar: THREE.BoxGeometry;
  hitProxy: THREE.CylinderGeometry;
  brainShapes: Record<BrainShapeKind, THREE.BufferGeometry>;
}

let sharedGeo: SharedRigGeometries | null = null;
let sharedShadowTex: THREE.CanvasTexture | null = null;

function createShadowDiscTexture(): THREE.CanvasTexture {
  if (sharedShadowTex) return sharedShadowTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(6, 12, 16, 0.56)');
  grad.addColorStop(0.55, 'rgba(6, 12, 16, 0.24)');
  grad.addColorStop(1, 'rgba(6, 12, 16, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  sharedShadowTex = tex;
  return tex;
}

function createFaeWingGeometry(upper: boolean): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const pos = upper
    ? new Float32Array([
        0, 0, 0,
        0.78, 0.54, -0.14,
        0.58, -0.06, -0.08,
        0, 0, 0,
        0.58, -0.06, -0.08,
        0.22, -0.22, -0.04,
      ])
    : new Float32Array([
        0, -0.06, 0,
        0.52, -0.18, -0.12,
        0.34, -0.58, -0.06,
      ]);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function createQuirkyTorsoGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const topY = 0.44;
  const botY = -0.34;
  const tw = 0.42;
  const td = 0.24;
  const bw = 0.17;
  const bd = 0.14;

  const v = [
    [-tw, topY, td * 0.85],
    [tw, topY, td * 0.85],
    [0, topY - 0.08, td * 1.35],
    [tw * 0.82, topY, -td],
    [-tw * 0.82, topY, -td],
    [-bw, botY, bd],
    [bw, botY, bd],
    [bw * 0.8, botY, -bd],
    [-bw * 0.8, botY, -bd],
  ];

  const indices = [
    0, 2, 1,
    0, 5, 2,
    2, 5, 6,
    2, 6, 1,
    4, 8, 5,
    4, 5, 0,
    1, 6, 7,
    1, 7, 3,
    3, 7, 8,
    3, 8, 4,
    4, 0, 1,
    4, 1, 3,
    5, 8, 7,
    5, 7, 6,
  ];

  const positions = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const p = v[indices[i]];
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = p[1];
    positions[i * 3 + 2] = p[2];
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function createWedgeBootGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const v = [
    [-0.12, 0.16, -0.1],
    [0.12, 0.16, -0.1],
    [0.0, 0.14, 0.12],
    [-0.15, 0.0, -0.14],
    [0.15, 0.0, -0.14],
    [0.0, 0.0, 0.34],
  ];
  const indices = [
    0, 2, 1,
    0, 3, 5,
    0, 5, 2,
    2, 5, 1,
    1, 5, 4,
    0, 1, 4,
    0, 4, 3,
    3, 4, 5,
  ];
  const pos = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const p = v[indices[i]];
    pos[i * 3] = p[0];
    pos[i * 3 + 1] = p[1];
    pos[i * 3 + 2] = p[2];
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function createCollarGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.46, 0.24, 0.14, 3);
  geo.rotateY(Math.PI);
  return geo;
}

function createVisorChevronGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array([
    -0.22, 0.04, 0,
    0.22, 0.04, 0,
    0.0, -0.09, 0.06,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function getSharedGeometries(): SharedRigGeometries {
  if (sharedGeo) return sharedGeo;
  const clearCube = new THREE.BoxGeometry(1.18, 1.18, 1.18);
  const clearCubeEdges = new THREE.EdgesGeometry(clearCube);

  sharedGeo = {
    clearCube,
    clearCubeEdges,
    cornerDot: new THREE.OctahedronGeometry(0.055, 0),
    torso: createQuirkyTorsoGeometry(),
    collar: createCollarGeometry(),
    chestEmblem: new THREE.OctahedronGeometry(0.11, 0),
    shoulder: new THREE.ConeGeometry(0.19, 0.26, 3),
    upperArm: new THREE.ConeGeometry(0.11, 0.62, 3),
    hand: new THREE.TetrahedronGeometry(0.12, 0),
    pelvis: new THREE.CylinderGeometry(0.22, 0.12, 0.22, 3),
    leg: new THREE.ConeGeometry(0.13, 0.66, 3),
    boot: createWedgeBootGeometry(),
    faeWingUpper: createFaeWingGeometry(true),
    faeWingLower: createFaeWingGeometry(false),
    antenna: new THREE.ConeGeometry(0.065, 0.28, 3),
    visorChevron: createVisorChevronGeometry(),
    shadowDisc: new THREE.CircleGeometry(0.95, 20),
    stageRing: new THREE.RingGeometry(1.05, 1.22, 32),
    vfxWaveRing: new THREE.RingGeometry(0.62, 0.84, 28),
    starCrown: new THREE.OctahedronGeometry(0.16, 0),
    drumHalo: new THREE.TorusGeometry(0.54, 0.022, 6, 24),
    eqBar: new THREE.BoxGeometry(0.14, 0.72, 0.08),
    hitProxy: new THREE.CylinderGeometry(1.12, 0.9, 3.4, 12),
    brainShapes: {
      tetra: new THREE.TetrahedronGeometry(0.22, 0),
      octa: new THREE.OctahedronGeometry(0.2, 0),
      icosa: new THREE.IcosahedronGeometry(0.19, 0),
      torus: new THREE.TorusGeometry(0.16, 0.065, 6, 14),
      knot: new THREE.TorusKnotGeometry(0.13, 0.042, 32, 6, 2, 3),
      dodeca: new THREE.DodecahedronGeometry(0.19, 0),
      cone: new THREE.ConeGeometry(0.17, 0.32, 5),
      prism: new THREE.CylinderGeometry(0.15, 0.15, 0.3, 3),
    },
  };
  return sharedGeo;
}

function applyPsxVertexSnap(
  material: THREE.MeshStandardMaterial,
  snapUniform: { value: number }
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPsxSnap = snapUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uPsxSnap;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         if (uPsxSnap > 0.01) {
           float grid = mix(220.0, 62.0, clamp(uPsxSnap, 0.0, 1.0));
           vec4 snapped = gl_Position;
           snapped.xyz = gl_Position.xyz / max(gl_Position.w, 0.0001);
           snapped.xy = floor(grid * snapped.xy + 0.5) / grid;
           snapped.xyz *= max(gl_Position.w, 0.0001);
           gl_Position = snapped;
         }`
      );
  };
  material.customProgramCacheKey = () => 'psx-vertex-snap-v1';
}

export class CharacterRig {
  public readonly id: string;
  public readonly root: THREE.Group;
  public readonly hitMesh: THREE.Mesh;

  private bodyRoot: THREE.Group;
  private headGroup: THREE.Group;
  private leftArmPivot: THREE.Group;
  private rightArmPivot: THREE.Group;
  private leftLegPivot: THREE.Group;
  private rightLegPivot: THREE.Group;
  private leftWingPivot: THREE.Group;
  private rightWingPivot: THREE.Group;
  private wingMat: THREE.MeshStandardMaterial;
  private antennaMesh: THREE.Mesh;

  private bodyMat: THREE.MeshStandardMaterial;
  private accentMat: THREE.MeshStandardMaterial;
  private darkTrimMat: THREE.MeshStandardMaterial;
  private glassMat: THREE.MeshPhysicalMaterial;
  private edgeMat: THREE.LineBasicMaterial;
  private psxSnapUniform = { value: 0.55 };

  private brainMeshes: [THREE.Mesh, THREE.Mesh, THREE.Mesh];
  private brainMats: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
  private brainKinds: [BrainShapeKind, BrainShapeKind, BrainShapeKind];


  // 3 internal music visualizer bars inside every Clear Cube head
  private eqBars: [THREE.Mesh, THREE.Mesh, THREE.Mesh];
  private eqMats: [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial, THREE.MeshBasicMaterial];

  // VFX Shockwave ring & center-stage ground reticle
  private vfxRing: THREE.Mesh;
  private vfxRingMat: THREE.MeshBasicMaterial;
  private vfxPulse = 0; // 1 -> 0 decay
  private vfxHue = 24;
  private prevAboveThreshold = false;
  private lastWaveFlashPhrase = -1;

  private shadowDisc: THREE.Mesh;
  private shadowMat: THREE.MeshBasicMaterial;
  private stageRing: THREE.Mesh;
  private stageRingMat: THREE.MeshBasicMaterial;

  // Role-specific insignia: glowing Drei Star crown for singers, rhythm halo for drummers
  private starCrownMesh: THREE.Mesh;
  private starCrownMat: THREE.MeshStandardMaterial;
  private drumHaloMesh: THREE.Mesh;
  private drumHaloMat: THREE.MeshBasicMaterial;
  private currentRole: InstrumentRole;

  // Center-stage smooth giant-head expansion state (0 = ring size 1.0x, 1 = giant center-stage 3.35x)
  private stageExpand = 0;
  private headBaseOffsetY = 2.16;

  private lastQuantizedFrame = -1;
  private readonly _color = new THREE.Color();

  constructor(initialState: CharacterState, isSoftwareGl: boolean) {
    this.id = initialState.id;
    this.currentRole = initialState.role;
    const geo = getSharedGeometries();

    this.root = new THREE.Group();
    this.bodyRoot = new THREE.Group();
    this.root.add(this.bodyRoot);

    // Click-to-stage hit proxy covering body + clear cube head
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    this.hitMesh = new THREE.Mesh(geo.hitProxy, hitMat);
    this.hitMesh.position.set(0, 1.7, 0);
    this.hitMesh.userData.characterId = this.id;
    this.root.add(this.hitMesh);

    this.psxSnapUniform.value = initialState.brain.jankLevel;

    this.bodyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(initialState.brain.bodyHue / 360, 0.52, 0.54),
      roughness: 0.72,
      metalness: 0.08,
      flatShading: true,
    });
    applyPsxVertexSnap(this.bodyMat, this.psxSnapUniform);

    this.accentMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(initialState.brain.accentHue / 360, 0.84, 0.55),
      roughness: 0.3,
      metalness: 0.42,
      flatShading: true,
    });
    applyPsxVertexSnap(this.accentMat, this.psxSnapUniform);

    this.darkTrimMat = new THREE.MeshStandardMaterial({
      color: 0x202636,
      roughness: 0.42,
      metalness: 0.35,
      flatShading: true,
    });
    applyPsxVertexSnap(this.darkTrimMat, this.psxSnapUniform);

    // 1. Quirky PSX Triangle Torso
    const torsoMesh = new THREE.Mesh(geo.torso, this.bodyMat);
    torsoMesh.position.set(0, 1.04, 0);
    torsoMesh.castShadow = !isSoftwareGl;
    torsoMesh.receiveShadow = true;
    this.bodyRoot.add(torsoMesh);

    const collarMesh = new THREE.Mesh(geo.collar, this.accentMat);
    collarMesh.position.set(0, 1.48, 0);
    collarMesh.castShadow = !isSoftwareGl;
    this.bodyRoot.add(collarMesh);

    const emblemMesh = new THREE.Mesh(geo.chestEmblem, this.accentMat);
    emblemMesh.position.set(0, 1.15, 0.31);
    emblemMesh.scale.set(0.9, 1.35, 0.55);
    this.bodyRoot.add(emblemMesh);

    const pelvisMesh = new THREE.Mesh(geo.pelvis, this.darkTrimMat);
    pelvisMesh.position.set(0, 0.68, 0);
    pelvisMesh.castShadow = !isSoftwareGl;
    this.bodyRoot.add(pelvisMesh);

    // 2. Translucent Faceted Crystal Fae Wings (24 FPS musical flutter!)
    this.wingMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(initialState.brain.accentHue / 360, 0.78, 0.72),
      emissive: new THREE.Color().setHSL(initialState.brain.accentHue / 360, 0.85, 0.48),
      emissiveIntensity: 0.45,
      roughness: 0.16,
      metalness: 0.22,
      transparent: true,
      opacity: 0.66,
      side: THREE.DoubleSide,
      flatShading: true,
    });

    this.leftWingPivot = new THREE.Group();
    this.leftWingPivot.position.set(-0.14, 1.24, -0.24);
    const lUpper = new THREE.Mesh(geo.faeWingUpper, this.wingMat);
    const lLower = new THREE.Mesh(geo.faeWingLower, this.wingMat);
    lUpper.scale.x = -1;
    lLower.scale.x = -1;
    this.leftWingPivot.add(lUpper, lLower);
    this.bodyRoot.add(this.leftWingPivot);

    this.rightWingPivot = new THREE.Group();
    this.rightWingPivot.position.set(0.14, 1.24, -0.24);
    const rUpper = new THREE.Mesh(geo.faeWingUpper, this.wingMat);
    const rLower = new THREE.Mesh(geo.faeWingLower, this.wingMat);
    this.rightWingPivot.add(rUpper, rLower);
    this.bodyRoot.add(this.rightWingPivot);

    // 3. Left & Right Quirky Triangular Arms
    this.leftArmPivot = this.createArm(geo, -1, isSoftwareGl);
    this.leftArmPivot.position.set(-0.46, 1.38, 0);
    this.bodyRoot.add(this.leftArmPivot);

    this.rightArmPivot = this.createArm(geo, 1, isSoftwareGl);
    this.rightArmPivot.position.set(0.46, 1.38, 0);
    this.bodyRoot.add(this.rightArmPivot);

    // 4. Left & Right Quirky Triangular Legs + Pointy Wedge Boots
    this.leftLegPivot = this.createLeg(geo, isSoftwareGl);
    this.leftLegPivot.position.set(-0.18, 0.66, 0);
    this.bodyRoot.add(this.leftLegPivot);

    this.rightLegPivot = this.createLeg(geo, isSoftwareGl);
    this.rightLegPivot.position.set(0.18, 0.66, 0);
    this.bodyRoot.add(this.rightLegPivot);

    // 5. THE CLEAR CUBE HEAD (Music Visualizer Crystal — scales to 3.35x at Center Stage)
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 2.16, 0);
    this.bodyRoot.add(this.headGroup);

    this.glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xf4f9ff,
      metalness: 0.0,
      roughness: 0.05,
      transmission: isSoftwareGl ? 0 : 0.91,
      transparent: true,
      opacity: isSoftwareGl ? 0.26 : 0.96,
      ior: 1.5,
      thickness: 0.75,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      depthWrite: false,
      side: THREE.FrontSide,
    });

    const clearCubeMesh = new THREE.Mesh(geo.clearCube, this.glassMat);
    clearCubeMesh.renderOrder = 12;
    this.headGroup.add(clearCubeMesh);

    this.edgeMat = new THREE.LineBasicMaterial({
      color: 0x263147,
      transparent: true,
      opacity: 0.52,
    });
    const edgeLines = new THREE.LineSegments(geo.clearCubeEdges, this.edgeMat);
    edgeLines.renderOrder = 13;
    this.headGroup.add(edgeLines);

    const cornerPos = 0.59;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const rivet = new THREE.Mesh(geo.cornerDot, this.darkTrimMat);
          rivet.position.set(sx * cornerPos, sy * cornerPos, sz * cornerPos);
          this.headGroup.add(rivet);
        }
      }
    }

    const visor = new THREE.Mesh(geo.visorChevron, this.accentMat);
    visor.position.set(0, -0.52, 0.605);
    this.headGroup.add(visor);

    this.antennaMesh = new THREE.Mesh(geo.antenna, this.accentMat);
    this.antennaMesh.position.set(0.24, 0.72, -0.18);
    this.antennaMesh.rotation.z = -0.22;
    this.headGroup.add(this.antennaMesh);


    // 7. 3 Internal Equalizer Visualizer Bars (Bass / Mid / Treble) inside back of Clear Cube
    const eqBars: THREE.Mesh[] = [];
    const eqMats: THREE.MeshBasicMaterial[] = [];
    for (let i = 0; i < 3; i++) {
      const sp = initialState.brain.shapes[i];
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(sp.hue / 360, 0.9, 0.62),
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      });
      const bar = new THREE.Mesh(geo.eqBar, mat);
      bar.position.set((i - 1) * 0.28, -0.45, -0.44);
      bar.renderOrder = 5;
      this.headGroup.add(bar);
      eqBars.push(bar);
      eqMats.push(mat);
    }
    this.eqBars = eqBars as [THREE.Mesh, THREE.Mesh, THREE.Mesh];
    this.eqMats = eqMats as [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial, THREE.MeshBasicMaterial];

    // 8. THE 3 MUSIC-REACTIVE KOLMOGOROV BRAIN SHAPES INSIDE THE CLEAR CUBE
    const brainMats: THREE.MeshStandardMaterial[] = [];
    const brainMeshes: THREE.Mesh[] = [];
    const brainKinds: BrainShapeKind[] = [];

    for (let i = 0; i < 3; i++) {
      const sp = initialState.brain.shapes[i];
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(sp.hue / 360, 0.88, 0.56),
        emissive: new THREE.Color().setHSL(sp.hue / 360, 0.9, 0.42),
        emissiveIntensity: 0.45,
        roughness: 0.22,
        metalness: 0.28,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(geo.brainShapes[sp.kind], mat);
      mesh.renderOrder = 6;
      this.headGroup.add(mesh);
      brainMats.push(mat);
      brainMeshes.push(mesh);
      brainKinds.push(sp.kind);
    }

    this.brainMats = brainMats as [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
    this.brainMeshes = brainMeshes as [THREE.Mesh, THREE.Mesh, THREE.Mesh];
    this.brainKinds = brainKinds as [BrainShapeKind, BrainShapeKind, BrainShapeKind];

    // 9. Expanding VFX Shockwave Ring (fires on 47-key MIDI input or Bass/Mid/Treble threshold snap)
    this.vfxRingMat = new THREE.MeshBasicMaterial({
      color: 0xff5a26,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.vfxRing = new THREE.Mesh(geo.vfxWaveRing, this.vfxRingMat);
    this.vfxRing.rotation.x = -Math.PI / 2;
    this.vfxRing.visible = false;
    this.vfxRing.renderOrder = 15;
    this.headGroup.add(this.vfxRing);

    // 10. Grounded Contact Shadow Disc
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: createShadowDiscTexture(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.shadowDisc = new THREE.Mesh(geo.shadowDisc, this.shadowMat);
    this.shadowDisc.rotation.x = -Math.PI / 2;
    this.shadowDisc.position.y = 0.025;
    this.shadowDisc.renderOrder = 2;
    this.root.add(this.shadowDisc);

    // 11. Center-Stage Floor Ring
    this.stageRingMat = new THREE.MeshBasicMaterial({
      color: 0xff5a26,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.stageRing = new THREE.Mesh(geo.stageRing, this.stageRingMat);
    this.stageRing.rotation.x = -Math.PI / 2;
    this.stageRing.position.y = 0.032;
    this.stageRing.visible = false;
    this.stageRing.renderOrder = 3;
    this.root.add(this.stageRing);

    // 12. Role Insignia: Drei Star Crown (for Bass / Melody / Harmony Singers) & Rhythm Halo (for 4 Drum Roles)
    const singerHue = isSingerRole(initialState.role) ? DREI_STAR_HUES[initialState.role] : initialState.brain.accentHue;
    this.starCrownMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(singerHue / 360, 0.92, 0.78),
      emissive: new THREE.Color().setHSL(singerHue / 360, 0.95, 0.56),
      emissiveIntensity: 1.25,
      roughness: 0.16,
      metalness: 0.3,
      flatShading: true,
    });
    this.starCrownMesh = new THREE.Mesh(geo.starCrown, this.starCrownMat);
    this.starCrownMesh.position.set(0, 0.96, 0);
    this.starCrownMesh.visible = isSingerRole(initialState.role);
    this.headGroup.add(this.starCrownMesh);

    this.drumHaloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(initialState.brain.accentHue / 360, 0.9, 0.64),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.drumHaloMesh = new THREE.Mesh(geo.drumHalo, this.drumHaloMat);
    this.drumHaloMesh.rotation.x = Math.PI / 2;
    this.drumHaloMesh.position.set(0, 0.94, 0);
    this.drumHaloMesh.visible = !isSingerRole(initialState.role);
    this.bodyRoot.add(this.drumHaloMesh);

    this.root.position.set(initialState.x, initialState.y, initialState.z);
    this.root.rotation.y = initialState.yaw;
  }

  private createArm(geo: SharedRigGeometries, side: -1 | 1, isSoftwareGl: boolean): THREE.Group {
    const pivot = new THREE.Group();
    const shoulder = new THREE.Mesh(geo.shoulder, this.accentMat);
    shoulder.rotation.z = side * -0.55;
    shoulder.castShadow = !isSoftwareGl;
    pivot.add(shoulder);

    const arm = new THREE.Mesh(geo.upperArm, this.bodyMat);
    arm.position.set(side * 0.05, -0.34, 0);
    arm.rotation.z = Math.PI + side * 0.14;
    arm.castShadow = !isSoftwareGl;
    pivot.add(arm);

    const hand = new THREE.Mesh(geo.hand, this.darkTrimMat);
    hand.position.set(side * 0.09, -0.66, 0.04);
    hand.rotation.set(0.4, side * 0.6, 0.2);
    pivot.add(hand);

    return pivot;
  }

  private createLeg(geo: SharedRigGeometries, isSoftwareGl: boolean): THREE.Group {
    const pivot = new THREE.Group();
    const leg = new THREE.Mesh(geo.leg, this.bodyMat);
    leg.position.set(0, -0.3, 0);
    leg.rotation.z = Math.PI;
    leg.castShadow = !isSoftwareGl;
    pivot.add(leg);

    const boot = new THREE.Mesh(geo.boot, this.darkTrimMat);
    boot.position.set(0, -0.66, 0);
    boot.castShadow = !isSoftwareGl;
    pivot.add(boot);

    return pivot;
  }

  public syncRole(role: InstrumentRole, accentHue: number): void {
    this.currentRole = role;
    const singer = isSingerRole(role);
    this.starCrownMesh.visible = singer;
    this.drumHaloMesh.visible = !singer;
    if (singer) {
      const starHue = DREI_STAR_HUES[role];
      this.starCrownMat.color.setHSL(starHue / 360, 0.92, 0.78);
      this.starCrownMat.emissive.setHSL(starHue / 360, 0.95, 0.56);
    } else {
      this.drumHaloMat.color.setHSL(accentHue / 360, 0.9, 0.64);
    }
  }

  public syncBrain(brain: KolmogorovBrain): void {
    const geo = getSharedGeometries();
    this.psxSnapUniform.value = brain.jankLevel;
    this.bodyMat.color.setHSL(brain.bodyHue / 360, 0.52, 0.54);
    this.accentMat.color.setHSL(brain.accentHue / 360, 0.84, 0.55);
    this.wingMat.color.setHSL(brain.accentHue / 360, 0.78, 0.72);
    this.wingMat.emissive.setHSL(brain.accentHue / 360, 0.85, 0.48);
    this.drumHaloMat.color.setHSL(brain.accentHue / 360, 0.9, 0.64);

    for (let i = 0; i < 3; i++) {
      const sp = brain.shapes[i];
      if (this.brainKinds[i] !== sp.kind) {
        this.brainMeshes[i].geometry = geo.brainShapes[sp.kind];
        this.brainKinds[i] = sp.kind;
      }
      this.eqMats[i].color.setHSL(sp.hue / 360, 0.9, 0.62);
    }
  }

  /**
   * Fires a harmonic VFX burst on this cube head (from 47-key MIDI note, threshold snap, or 8-bar break)
   */
  public triggerVfxPulse(hue: number, strength = 1.0): void {
    this.vfxHue = hue;
    this.vfxPulse = Math.max(this.vfxPulse, Math.min(1.45, strength));
  }

  public getHeadWorldY(): number {
    return this.root.position.y + this.bodyRoot.position.y + this.headGroup.position.y;
  }

  public update(
    state: CharacterState,
    isCenterStage: boolean,
    atCenterStage: boolean,
    elapsedSec: number,
    nowMs: number,
    audio: AudioBands,
    clock: MusicalClock,
    delta: number
  ): void {
    this.root.position.set(state.x, state.y, state.z);
    this.root.rotation.y = state.yaw;

    // Smoothly inflate head HUGE (3.35x) once staged and nearing center stage; shrink cleanly back to 1.0x on release
    const targetExpand = isCenterStage && atCenterStage ? 1 : isCenterStage ? 0.35 : 0;
    this.stageExpand = THREE.MathUtils.damp(this.stageExpand, targetExpand, 5.8, delta);

    // Threshold Snap VFX evaluation (Bass / Mid / Treble crossing snapThreshold)
    const snapBand = state.brain.snapBand ?? 'bass';
    const snapThreshold = state.brain.snapThreshold ?? 0.52;
    const triggerMode = state.brain.vfxTriggerMode ?? 'on-beat';
    const bandEnergy =
      snapBand === 'bass' ? audio.bass : snapBand === 'mid' ? audio.mid : audio.treble;
    const bandIdx = snapBand === 'bass' ? 0 : snapBand === 'mid' ? 1 : 2;
    const above = bandEnergy >= snapThreshold;

    if (triggerMode === 'on-beat') {
      if (clock.justHitBeat && above) {
        this.triggerVfxPulse(state.brain.shapes[bandIdx].hue, 0.72 + bandEnergy * 0.45);
      }
    } else {
      if (above && !this.prevAboveThreshold) {
        this.triggerVfxPulse(state.brain.shapes[bandIdx].hue, 0.85 + bandEnergy * 0.4);
      }
    }
    this.prevAboveThreshold = above;

    // Decay VFX shockwave pulse smoothly
    if (this.vfxPulse > 0.005) {
      this.vfxPulse = Math.max(0, this.vfxPulse - delta * 2.45);
      const progress = 1 - Math.min(1, this.vfxPulse);
      this.vfxRing.visible = true;
      const ringScale = 0.82 + progress * (isCenterStage ? 1.55 : 2.1);
      this.vfxRing.scale.setScalar(ringScale);
      this.vfxRing.rotation.z = elapsedSec * 3.0;
      this.vfxRingMat.color.setHSL((((this.vfxHue % 360) + 360) % 360) / 360, 0.95, 0.58);
      this.vfxRingMat.opacity = Math.min(0.88, this.vfxPulse * 0.92);
    } else {
      this.vfxRing.visible = false;
    }

    // Grounded contact shadow (expands subtly beneath the giant staged head)
    this.shadowDisc.position.y = -state.y + 0.025;
    const shadowScale = (1 + this.stageExpand * 0.9) * Math.max(0.35, 1 - this.bodyRoot.position.y * 0.085);
    this.shadowDisc.scale.setScalar(shadowScale);
    this.shadowMat.opacity = 0.52 * Math.max(0.35, 1 - this.bodyRoot.position.y * 0.08);

    // Center-stage floor ring
    this.stageRing.visible = this.stageExpand > 0.04;
    if (this.stageRing.visible) {
      this.stageRing.position.y = -state.y + 0.032;
      const pulse = 1 + audio.beatPulse * 0.06 + this.vfxPulse * 0.08;
      this.stageRing.scale.setScalar((0.8 + this.stageExpand * 0.7) * pulse);
      this.stageRing.rotation.z = elapsedSec * 0.55;
      this.stageRingMat.opacity = this.stageExpand * 0.65;
      this.stageRingMat.color.setHSL(
        this.vfxPulse > 0.12 ? ((((this.vfxHue % 360) + 360) % 360) / 360) : 16 / 360,
        0.92,
        0.56
      );
    }

    // Keep role insignia synchronized if role changed live
    if (this.currentRole !== state.role) {
      this.syncRole(state.role, state.brain.accentHue);
    }

    // Animate Role Insignia (Drei Star crown for singers; rhythm waist halo for drummers)
    if (this.starCrownMesh.visible) {
      this.starCrownMesh.rotation.y = elapsedSec * 1.9;
      this.starCrownMesh.rotation.x = Math.sin(elapsedSec * 1.4) * 0.35;
      this.starCrownMesh.position.y = 0.94 + Math.sin(elapsedSec * 3.0 + state.orbitAngle) * 0.05;
      const crownScale = (state.muted ? 0.55 : 1.0) + this.vfxPulse * 0.55;
      this.starCrownMesh.scale.setScalar(crownScale);
      this.starCrownMat.emissiveIntensity = state.muted ? 0.25 : 1.05 + this.vfxPulse * 1.9;
    }
    if (this.drumHaloMesh.visible) {
      const haloScale = 1 + this.vfxPulse * 0.48;
      this.drumHaloMesh.scale.setScalar(haloScale);
      this.drumHaloMesh.rotation.z = elapsedSec * 1.6;
      this.drumHaloMat.opacity = state.muted ? 0.12 : Math.min(0.92, 0.34 + this.vfxPulse * 0.62);
    }

    // BPM-COUPLED QUANTIZED PSX BODY ANIMATION:
    // 12 quantized animation frames per quarter beat => animFps = 0.2 * bpm (24 FPS at 120 BPM!)
    // Each half-beat (0.5 beats) = 1 crisp step -> 8 steps per 4/4 bar: STEP step STEP step STEP step STEP step
    const framesPerBeat = 12;
    const frameIndex = Math.floor(clock.exactBeats * framesPerBeat);
    const qBeats = frameIndex / framesPerBeat;
    const tBeat = qBeats * 0.5; // equivalent to seconds at 120 BPM so break dances scale cleanly with BPM
    const jank = 0.65 + state.brain.jankLevel * 0.7;

    if (frameIndex !== this.lastQuantizedFrame) {
      this.lastQuantizedFrame = frameIndex;
      this.headBaseOffsetY = 2.16;

      if (isCenterStage && !state.moving) {
        // Center-stage poised groove beneath the giant Clear Cube head (synced to BPM)
        const groove = Math.sin(qBeats * Math.PI * 2);
        this.bodyRoot.position.y = Math.max(0, groove * 0.045 + audio.beatPulse * 0.06 + this.vfxPulse * 0.08);
        this.bodyRoot.rotation.set(0, Math.sin(qBeats * Math.PI * 0.5) * 0.05, Math.sin(qBeats * Math.PI) * 0.035);
        this.headGroup.rotation.set(
          Math.sin(qBeats * Math.PI) * 0.035,
          Math.sin(qBeats * Math.PI * 0.5) * 0.09,
          Math.cos(qBeats * Math.PI) * 0.03
        );
        this.leftArmPivot.rotation.set(
          Math.sin(qBeats * Math.PI) * 0.18,
          0,
          -0.22 - audio.mid * 0.2 - this.vfxPulse * 0.52
        );
        this.rightArmPivot.rotation.set(
          -Math.sin(qBeats * Math.PI) * 0.18,
          0,
          0.22 + audio.mid * 0.2 + this.vfxPulse * 0.52
        );
        this.leftLegPivot.rotation.x = 0;
        this.rightLegPivot.rotation.x = 0;
        const wingBeat = 0.24 + Math.sin(qBeats * Math.PI * 4) * (0.22 + audio.treble * 0.25) + this.vfxPulse * 0.35;
        this.leftWingPivot.rotation.y = wingBeat;
        this.rightWingPivot.rotation.y = -wingBeat;
        this.wingMat.emissiveIntensity = 0.42 + audio.mid * 0.45 + this.vfxPulse * 0.9;
      } else if (isCenterStage && state.moving) {
        // Purposeful BPM-locked half-beat STEP/step stride walking into hearthside center stage
        const halfPhase = qBeats * 2;
        const isDownStep = Math.floor(halfPhase) % 2 === 0;
        const accent = isDownStep ? 1.0 : 0.62;
        const stepAngle = halfPhase * Math.PI;
        const s = Math.sin(stepAngle);
        this.bodyRoot.position.y = Math.abs(Math.sin(stepAngle)) * (0.14 * accent) * jank;
        this.bodyRoot.rotation.set(0.11, s * 0.12 * accent, Math.cos(stepAngle) * 0.08 * accent);
        this.headGroup.rotation.set(-0.04, -s * 0.07, Math.sin(stepAngle) * 0.05);
        this.leftArmPivot.rotation.set(s * 0.95 * accent * jank, 0, -0.24);
        this.rightArmPivot.rotation.set(-s * 0.95 * accent * jank, 0, 0.24);
        this.leftLegPivot.rotation.x = -s * 0.92 * accent * jank;
        this.rightLegPivot.rotation.x = s * 0.92 * accent * jank;
        const wingBeat = 0.35 + Math.sin(qBeats * Math.PI * 4) * 0.32;
        this.leftWingPivot.rotation.y = wingBeat;
        this.rightWingPivot.rotation.y = -wingBeat;
        this.wingMat.emissiveIntensity = 0.52 + audio.beatPulse * 0.45;
      } else if (clock.isBreakBar) {
        // EVERY 8 BARS: ETERNAL RING DANCERS STOP & PERFORM CHOREOGRAPHED GROUP BREAK (locked to BPM!)
        this.animateEightBarBreak(state, clock, tBeat, jank);
      } else {
        // ETERNAL CIRCLE MARCH DANCE: EXACT HALF-BEAT FOOTWORK (STEP step STEP step STEP step STEP step)
        // 8 half-beat steps per 4/4 bar: even half-beats = big STEP (1.0), odd half-beats = nimble step (0.58)
        const halfPhase = qBeats * 2;
        const isBigStep = Math.floor(halfPhase) % 2 === 0;
        const stepAccent = isBigStep ? 1.0 : 0.58;
        const stepAngle = halfPhase * Math.PI;
        const stride = Math.sin(stepAngle);
        const stepHop = Math.abs(Math.sin(stepAngle));
        const mutedScale = state.muted ? 0.5 : 1.0;

        const bounce =
          stepHop * (0.19 * stepAccent + audio.beatPulse * 0.09) * jank * mutedScale +
          this.vfxPulse * 0.14;

        this.bodyRoot.position.y = bounce;
        this.bodyRoot.rotation.set(
          0.08 + stepHop * 0.08 * stepAccent,
          stride * 0.18 * stepAccent * jank,
          Math.cos(stepAngle) * 0.14 * stepAccent * jank
        );
        this.headGroup.rotation.set(
          (isBigStep ? 0.11 : -0.05) * stepHop,
          Math.cos(stepAngle) * 0.2 * stepAccent * jank,
          stride * 0.13 * stepAccent * jank
        );

        this.leftArmPivot.rotation.set(
          stride * 1.18 * stepAccent * jank,
          0,
          -0.32 - audio.mid * 0.35 - this.vfxPulse * 0.32
        );
        this.rightArmPivot.rotation.set(
          -stride * 1.18 * stepAccent * jank,
          0,
          0.32 + audio.mid * 0.35 + this.vfxPulse * 0.32
        );
        this.leftLegPivot.rotation.x = -stride * 0.96 * stepAccent * jank;
        this.rightLegPivot.rotation.x = stride * 0.96 * stepAccent * jank;

        const wingBeat = 0.26 + Math.sin(halfPhase * Math.PI) * (0.28 * stepAccent + audio.beatPulse * 0.22);
        this.leftWingPivot.rotation.y = wingBeat;
        this.rightWingPivot.rotation.y = -wingBeat;
        this.wingMat.emissiveIntensity = state.muted
          ? 0.15
          : 0.4 + audio.beatPulse * 0.42 + this.vfxPulse * 0.95;
      }

      this.antennaMesh.rotation.z =
        -0.22 + Math.sin(qBeats * Math.PI * 4) * (0.1 + audio.treble * 0.35 + this.vfxPulse * 0.45);
    }

    // Apply smooth Giant-Head Center-Stage Scale (1.0x -> 3.35x) & vertical clearance every render frame
    const headScale = 1 + this.stageExpand * 2.35 + this.vfxPulse * (0.045 + this.stageExpand * 0.04);
    this.headGroup.scale.setScalar(headScale);
    this.headGroup.position.set(0, this.headBaseOffsetY + this.stageExpand * 1.52, 0);

    // Keep hit proxy matched to either ring dancer or giant staged head
    const hitScaleXZ = 1 + this.stageExpand * 1.35;
    const hitScaleY = 1 + this.stageExpand * 0.95;
    this.hitMesh.scale.set(hitScaleXZ, hitScaleY, hitScaleXZ);
    this.hitMesh.position.y = 1.7 + this.stageExpand * 1.65;

    // UPDATE INTERNAL 3-BAR MUSIC VISUALIZER + 3 MODULAR SHAPES INSIDE THE CLEAR CUBE
    const bands: [number, number, number] = [audio.bass, audio.mid, audio.treble];
    const bootAgeSec = (nowMs - state.bootAt) / 1000;
    const complexity = state.brain.complexity;

    for (let i = 0; i < 3; i++) {
      const sp = state.brain.shapes[i];
      const mesh = this.brainMeshes[i];
      const mat = this.brainMats[i];
      const energy = bands[i] * sp.reactivity + this.vfxPulse * 0.65;

      // Update internal equalizer bar inside Clear Cube head
      const barH = Math.max(0.12, Math.min(1.25, 0.18 + bands[i] * 1.25 + this.vfxPulse * 0.42));
      this.eqBars[i].scale.set(1, barH, 1);
      this.eqBars[i].position.y = -0.5 + barH * 0.36;
      this.eqMats[i].opacity = Math.min(0.85, 0.28 + bands[i] * 0.55 + this.vfxPulse * 0.3);

      // 1-2-3 Kinetic Bootup Choreography
      const dropDelay = 0.14 + i * 0.26;
      let bootScaleMult = 1;
      let bootDropY = 0;
      let bootFlash = 0;

      if (bootAgeSec >= 0 && bootAgeSec < 1.65) {
        const localT = bootAgeSec - dropDelay;
        if (localT < 0) {
          bootScaleMult = 0.001;
        } else if (localT < 0.32) {
          const p = localT / 0.32;
          const overshoot = 1 + Math.sin(p * Math.PI) * 0.55;
          bootScaleMult = p * overshoot;
          bootDropY = (1 - p) * (1 - p) * 0.58;
          bootFlash = (1 - p) * 1.4;
        } else if (bootAgeSec > 0.95 && bootAgeSec < 1.45) {
          const bloomP = (bootAgeSec - 0.95) / 0.5;
          const bell = Math.sin(bloomP * Math.PI);
          bootScaleMult = 1 + bell * 0.32;
          bootFlash = bell * 1.6;
        }
      }

      const orbitPhase =
        elapsedSec * sp.orbitSpeed * (0.85 + complexity * 0.65) +
        i * ((Math.PI * 2) / 3);
      const orbitR = (0.2 + complexity * 0.1 + energy * 0.05) * (i === 0 ? 0.85 : 1.0);
      const bx = Math.cos(orbitPhase) * orbitR;
      const by =
        Math.sin(orbitPhase * (1.3 + i * 0.35 + complexity * 0.5)) * (0.21 + energy * 0.06) + bootDropY;
      const bz = Math.sin(orbitPhase) * orbitR;

      mesh.position.set(bx, Math.max(-0.36, Math.min(0.42, by)), bz);

      const baseScale = sp.scale * (0.74 + energy * 0.52) * bootScaleMult;
      const stretchX = baseScale * (1 + energy * 0.24 * Math.sin(elapsedSec * 6 + i));
      const stretchY = baseScale * (1 + energy * 0.28 * Math.cos(elapsedSec * 5 + i * 2));
      const stretchZ = baseScale * (1 + energy * 0.22);
      mesh.scale.set(stretchX, stretchY, stretchZ);

      mesh.rotation.x = elapsedSec * (1.1 + i * 0.5 + energy * 2.0);
      mesh.rotation.y = elapsedSec * (1.5 - i * 0.35 + energy * 2.4);
      mesh.rotation.z = elapsedSec * (0.7 + complexity * 1.4);

      const targetHue = this.vfxPulse > 0.22 ? this.vfxHue + i * 35 : sp.hue;
      const hueShift = (targetHue + energy * 44 + Math.sin(elapsedSec * 0.9 + i) * 14 * complexity) % 360;
      const lightness = Math.min(0.8, 0.52 + energy * 0.18 + bootFlash * 0.12);
      this._color.setHSL((((hueShift % 360) + 360) % 360) / 360, 0.92, lightness);
      mat.color.copy(this._color);
      mat.emissive.copy(this._color);
      mat.emissiveIntensity = 0.38 + energy * 1.2 + bootFlash + this.vfxPulse * 1.15;
    }

    // Clear Cube bezel edge flash on Boot, MIDI VFX snap, or Center Stage focus
    if ((bootAgeSec >= 0.92 && bootAgeSec < 1.45) || this.vfxPulse > 0.18) {
      this.edgeMat.color.setHSL((((this.vfxHue % 360) + 360) % 360) / 360, 0.95, 0.62);
      this.edgeMat.opacity = 0.92;
    } else if (isCenterStage) {
      this.edgeMat.color.setHex(0x9ce3f2);
      this.edgeMat.opacity = 0.72;
    } else {
      this.edgeMat.color.setHex(0x7fb4cc);
      this.edgeMat.opacity = 0.46;
    }
  }

  /**
   * 4 rotating 24 FPS PSX group dance breaks performed on Bar 8 of every 8-bar phrase
   */
  private animateEightBarBreak(
    state: CharacterState,
    clock: MusicalClock,
    t24: number,
    jank: number
  ): void {
    const p = clock.breakProgress;

    if (clock.breakStyle === 'wave') {
      const normAngle = (((state.orbitAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
      const waveLocal = p * 1.35 - normAngle * 0.55;
      const inWave = waveLocal > 0 && waveLocal < 0.42;
      const bell = inWave ? Math.sin((waveLocal / 0.42) * Math.PI) : 0;

      if (bell > 0.85 && this.lastWaveFlashPhrase !== clock.phraseIndex) {
        this.lastWaveFlashPhrase = clock.phraseIndex;
        this.triggerVfxPulse(state.brain.shapes[0].hue, 1.05);
      }

      this.bodyRoot.position.y = bell * 1.35;
      this.bodyRoot.rotation.set(-bell * 0.25, 0, Math.sin(t24 * 8) * 0.08);
      this.headGroup.rotation.set(-bell * 0.3, bell * Math.PI * 2, 0);
      this.leftArmPivot.rotation.set(-bell * 2.85, 0, -0.35 - bell * 0.5);
      this.rightArmPivot.rotation.set(-bell * 2.85, 0, 0.35 + bell * 0.5);
      this.leftLegPivot.rotation.x = bell * 0.55;
      this.rightLegPivot.rotation.x = -bell * 0.35;
      const wingWave = 0.2 + bell * 0.85;
      this.leftWingPivot.rotation.y = wingWave;
      this.rightWingPivot.rotation.y = -wingWave;
      this.wingMat.emissiveIntensity = 0.5 + bell * 1.4;
      return;
    }

    if (clock.breakStyle === 'mega-twirl') {
      if (p < 0.22) {
        const c = p / 0.22;
        this.bodyRoot.position.y = -c * 0.22;
        this.bodyRoot.rotation.set(c * 0.35, 0, 0);
        this.leftArmPivot.rotation.set(0.8, 0, -0.4);
        this.rightArmPivot.rotation.set(0.8, 0, 0.4);
        this.leftLegPivot.rotation.x = -0.45 * c;
        this.rightLegPivot.rotation.x = -0.45 * c;
      } else if (p < 0.84) {
        const air = (p - 0.22) / 0.62;
        const arc = Math.sin(air * Math.PI);
        this.bodyRoot.position.y = arc * 2.2;
        this.bodyRoot.rotation.set(0.1, air * Math.PI * 4, Math.sin(air * Math.PI * 2) * 0.16);
        this.headGroup.rotation.set(0, -air * Math.PI * 2, 0);
        this.leftArmPivot.rotation.set(0, 0, -1.45);
        this.rightArmPivot.rotation.set(0, 0, 1.45);
        this.leftLegPivot.rotation.x = 0.4 * arc;
        this.rightLegPivot.rotation.x = -0.4 * arc;
        const flutter = 0.45 + Math.sin(t24 * 26) * 0.45;
        this.leftWingPivot.rotation.y = flutter;
        this.rightWingPivot.rotation.y = -flutter;
        this.wingMat.emissiveIntensity = 1.5;
      } else {
        const land = (p - 0.84) / 0.16;
        this.bodyRoot.position.y = (1 - land) * 0.12;
        this.bodyRoot.rotation.set(0, 0, 0);
        this.leftArmPivot.rotation.set(-2.5, 0, -0.6);
        this.rightArmPivot.rotation.set(-2.5, 0, 0.6);
        this.leftLegPivot.rotation.x = 0;
        this.rightLegPivot.rotation.x = 0;
        if (this.lastWaveFlashPhrase !== clock.phraseIndex) {
          this.lastWaveFlashPhrase = clock.phraseIndex;
          this.triggerVfxPulse(state.brain.shapes[1].hue, 1.15);
        }
      }
      return;
    }

    if (clock.breakStyle === 'moon-spin') {
      const spin = p < 0.65 ? (p / 0.65) * Math.PI * 2 : Math.PI * 2;
      const hop = Math.abs(Math.sin(p * Math.PI * 4)) * 0.48;
      this.bodyRoot.position.y = hop;
      this.bodyRoot.rotation.set(-0.22 * Math.sin(p * Math.PI), spin, Math.sin(t24 * 16) * 0.14 * jank);
      this.headGroup.rotation.set(0.15, Math.sin(t24 * 12) * 0.35, 0);
      this.leftArmPivot.rotation.set(-1.7 + Math.sin(t24 * 20) * 0.4, 0, -0.9);
      this.rightArmPivot.rotation.set(-1.7 - Math.sin(t24 * 20) * 0.4, 0, 0.9);
      this.leftLegPivot.rotation.x = Math.sin(t24 * 16) * 0.65;
      this.rightLegPivot.rotation.x = -Math.sin(t24 * 16) * 0.65;
      const spinWing = 0.55 + Math.sin(t24 * 22) * 0.35;
      this.leftWingPivot.rotation.y = spinWing;
      this.rightWingPivot.rotation.y = -spinWing;
      this.wingMat.emissiveIntensity = 1.1;
      return;
    }

    // 'head-pop': Bodies freeze while Clear Cube heads levitate & spin
    const lift = Math.sin(p * Math.PI);
    this.bodyRoot.position.y = 0;
    this.bodyRoot.rotation.set(0, 0, 0);
    this.leftArmPivot.rotation.set(0, 0, -0.55 - lift * 0.55);
    this.rightArmPivot.rotation.set(0, 0, 0.55 + lift * 0.55);
    this.leftLegPivot.rotation.x = 0;
    this.rightLegPivot.rotation.x = 0;

    this.headBaseOffsetY = 2.16 + lift * 0.85;
    this.headGroup.rotation.set(lift * 0.35, p * Math.PI * 6, Math.sin(p * Math.PI * 4) * 0.25);
    this.leftWingPivot.rotation.y = 0.3 + lift * 0.65;
    this.rightWingPivot.rotation.y = -(0.3 + lift * 0.65);
    this.wingMat.emissiveIntensity = 0.6 + lift * 1.2;
    if (lift > 0.92 && this.lastWaveFlashPhrase !== clock.phraseIndex) {
      this.lastWaveFlashPhrase = clock.phraseIndex;
      this.triggerVfxPulse(state.brain.shapes[2].hue, 1.15);
    }
  }

  public dispose(): void {
    this.bodyMat.dispose();
    this.accentMat.dispose();
    this.darkTrimMat.dispose();
    this.glassMat.dispose();
    this.edgeMat.dispose();
    this.wingMat.dispose();
    this.shadowMat.dispose();
    this.stageRingMat.dispose();
    this.vfxRingMat.dispose();
    this.starCrownMat.dispose();
    this.drumHaloMat.dispose();
    (this.hitMesh.material as THREE.Material).dispose();
    for (const m of this.brainMats) m.dispose();
    for (const m of this.eqMats) m.dispose();
  }
}
