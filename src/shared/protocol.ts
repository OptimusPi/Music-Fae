import type { BeatDocument, InstrumentRole } from './beatSchema';

export type BrainShapeKind =
  | 'tetra'
  | 'octa'
  | 'icosa'
  | 'torus'
  | 'knot'
  | 'dodeca'
  | 'cone'
  | 'prism';

export const BRAIN_SHAPE_KINDS: BrainShapeKind[] = [
  'tetra',
  'octa',
  'icosa',
  'torus',
  'knot',
  'dodeca',
  'cone',
  'prism',
];

export const BRAIN_SHAPE_LABELS: Record<BrainShapeKind, string> = {
  tetra: 'Tetra',
  octa: 'Octa',
  icosa: 'Icosa',
  torus: 'Torus',
  knot: 'Knot',
  dodeca: 'Dodeca',
  cone: 'Cone',
  prism: 'Prism',
};

export interface BrainShapeParams {
  kind: BrainShapeKind;
  hue: number; // 0..359
  scale: number; // 0.55..1.45
  orbitSpeed: number; // 0.5..2.8
  reactivity: number; // 0.4..1.8
}

export type VfxTriggerMode = 'on-beat' | 'single';
export type SnapBand = 'bass' | 'mid' | 'treble';

export interface KolmogorovBrain {
  seed: string;
  complexity: number; // 0..1
  jankLevel: number; // 0..1 (PSX vertex snap + BPM-coupled step exaggeration)
  bodyHue: number; // 0..359
  accentHue: number; // 0..359
  shapes: [BrainShapeParams, BrainShapeParams, BrainShapeParams];
  vfxTriggerMode?: VfxTriggerMode;
  snapBand?: SnapBand;
  snapThreshold?: number; // 0.1..0.95
}

export type CharacterMode = 'walk' | 'fly' | 'abandoned' | 'toasted';

export interface CharacterState {
  id: string;
  ownerId: string | null;
  label: string;
  role: InstrumentRole;
  variant: string;
  steps: number[]; // 16-step sequencer pattern (0..1)
  notes?: Array<number | null>; // Optional 16-step MIDI pitches for singer roles
  gain: number; // 0.1..1.2
  muted: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  mode: CharacterMode;
  orbitRadius: number;
  orbitAngle: number;
  orbitSpeed: number;
  orbitDir: 1 | -1;
  bootAt: number; // timestamp ms for 1-2-3 boot sequence
  brain: KolmogorovBrain;
  moving: boolean;
}

export interface RoomSnapshot {
  roomId: string;
  serverTime: number;
  clientCount: number;
  bpm: number;
  characters: CharacterState[];
}

export type ClientToServerMessage =
  | { type: 'hello'; clientId: string }
  | { type: 'spawn'; character: CharacterState }
  | {
      type: 'update';
      id: string;
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      yaw: number;
      mode: CharacterMode;
      moving: boolean;
      bootAt?: number;
      brain?: KolmogorovBrain;
      role?: InstrumentRole;
      variant?: string;
      steps?: number[];
      notes?: Array<number | null>;
      gain?: number;
      muted?: boolean;
    }
  | {
      type: 'abandon';
      id: string;
      x: number;
      y: number;
      z: number;
      yaw: number;
      orbitRadius: number;
      orbitAngle: number;
      orbitSpeed: number;
      orbitDir: 1 | -1;
    }
  | { type: 'set_bpm'; bpm: number }
  | { type: 'load_beat'; beat: BeatDocument; characters: CharacterState[] }
  | { type: 'toast'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'clear_abandoned' };

export type ServerToClientMessage =
  | { type: 'snapshot'; snapshot: RoomSnapshot }
  | { type: 'character:spawned'; character: CharacterState }
  | {
      type: 'character:updated';
      id: string;
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      yaw: number;
      mode: CharacterMode;
      moving: boolean;
      bootAt?: number;
      brain?: KolmogorovBrain;
      role?: InstrumentRole;
      variant?: string;
      steps?: number[];
      notes?: Array<number | null>;
      gain?: number;
      muted?: boolean;
    }
  | {
      type: 'character:abandoned';
      id: string;
      x: number;
      y: number;
      z: number;
      yaw: number;
      orbitRadius: number;
      orbitAngle: number;
      orbitSpeed: number;
      orbitDir: 1 | -1;
    }
  | { type: 'character:removed'; id: string }
  | { type: 'room:presence'; clientCount: number }
  | { type: 'room:bpm'; bpm: number }
  | { type: 'room:beat_loaded'; bpm: number; characters: CharacterState[] }
  | { type: 'room:cleared_abandoned'; remainingIds: string[] };

export const CUBE_HALF_SIZE = 13; // 26x26 big cube floor
export const MARCH_RING_BASE_RADIUS = 8.4;

/**
 * Deterministic PRNG (Mulberry32) used to unfold compact Kolmogorov seed strings
 * into full 3-shape brain geometry, color harmonies, and PSX body palettes.
 */
function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compact bi-directional Kolmogorov seed encoding:
 * Format "K3:<S1><S2><S3>-<H1><H2><H3>-<K><J><B>"
 * where every character packs discrete brain parameters, OR any free-form
 * arbitrary string deterministically expands into a unique musical brain.
 */
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function toB36(n: number, maxVal: number): string {
  const clamped = Math.max(0, Math.min(maxVal, Math.round(n)));
  return B36[clamped % 36];
}

function fromB36(ch: string): number {
  const idx = B36.indexOf(ch.toUpperCase());
  return idx >= 0 ? idx : 0;
}

export function encodeKolmogorov(brain: Omit<KolmogorovBrain, 'seed'>): string {
  const s = brain.shapes;
  const k0 = BRAIN_SHAPE_KINDS.indexOf(s[0].kind);
  const k1 = BRAIN_SHAPE_KINDS.indexOf(s[1].kind);
  const k2 = BRAIN_SHAPE_KINDS.indexOf(s[2].kind);

  const h0 = Math.round(((s[0].hue % 360) + 360) % 360 / 10) % 36;
  const h1 = Math.round(((s[1].hue % 360) + 360) % 360 / 10) % 36;
  const h2 = Math.round(((s[2].hue % 360) + 360) % 360 / 10) % 36;

  const sc0 = Math.round(((s[0].scale - 0.55) / 0.9) * 35);
  const sc1 = Math.round(((s[1].scale - 0.55) / 0.9) * 35);
  const sc2 = Math.round(((s[2].scale - 0.55) / 0.9) * 35);

  const comp = Math.round(brain.complexity * 35);
  const jank = Math.round(brain.jankLevel * 35);
  const body = Math.round(((brain.bodyHue % 360) + 360) % 360 / 10) % 36;

  return `K3:${toB36(k0, 7)}${toB36(k1, 7)}${toB36(k2, 7)}-${toB36(h0, 35)}${toB36(h1, 35)}${toB36(h2, 35)}-${toB36(sc0, 35)}${toB36(sc1, 35)}${toB36(sc2, 35)}-${toB36(comp, 35)}${toB36(jank, 35)}${toB36(body, 35)}`;
}

export function decodeKolmogorov(rawSeed: string): KolmogorovBrain {
  const trimmed = rawSeed.trim().toUpperCase();
  const strictMatch = /^K3:([0-7]{3})-([0-9A-Z]{3})-([0-9A-Z]{3})-([0-9A-Z]{3})$/.exec(trimmed);

  if (strictMatch) {
    const [, kinds, hues, scales, meta] = strictMatch;
    const complexity = fromB36(meta[0]) / 35;
    const jankLevel = fromB36(meta[1]) / 35;
    const bodyHue = (fromB36(meta[2]) * 10) % 360;
    const accentHue = (bodyHue + 145) % 360;

    const shapes: [BrainShapeParams, BrainShapeParams, BrainShapeParams] = [0, 1, 2].map((i) => {
      const kind = BRAIN_SHAPE_KINDS[parseInt(kinds[i], 10) % BRAIN_SHAPE_KINDS.length];
      const hue = (fromB36(hues[i]) * 10) % 360;
      const scale = 0.55 + (fromB36(scales[i]) / 35) * 0.9;
      return {
        kind,
        hue,
        scale: Number(scale.toFixed(2)),
        orbitSpeed: Number((0.75 + i * 0.45 + complexity * 1.1).toFixed(2)),
        reactivity: Number((0.75 + complexity * 0.85 + i * 0.12).toFixed(2)),
      };
    }) as [BrainShapeParams, BrainShapeParams, BrainShapeParams];

    return {
      seed: trimmed,
      complexity: Number(complexity.toFixed(2)),
      jankLevel: Number(jankLevel.toFixed(2)),
      bodyHue,
      accentHue,
      shapes,
    };
  }

  // Any free-form Kolmogorov program / phrase hashes deterministically into a full brain
  const rng = mulberry32(hashString(trimmed || 'CRYSTAL-FAE-HEARTH'));
  const baseHue = Math.floor(rng() * 36) * 10;
  const complexity = Number((0.28 + rng() * 0.65).toFixed(2));
  const jankLevel = Number((0.45 + rng() * 0.5).toFixed(2));
  const bodyHue = (baseHue + 180 + Math.floor(rng() * 4) * 20) % 360;
  const accentHue = (baseHue + 30) % 360;

  // Curated luminous triad hue harmonies for Crystal Fae twilight palettes
  const offsets = [0, 110 + Math.floor(rng() * 40), 220 + Math.floor(rng() * 40)];

  const shapes: [BrainShapeParams, BrainShapeParams, BrainShapeParams] = [0, 1, 2].map((i) => {
    const kind = BRAIN_SHAPE_KINDS[Math.floor(rng() * BRAIN_SHAPE_KINDS.length)];
    const hue = (baseHue + offsets[i]) % 360;
    const scale = Number((0.72 + rng() * 0.55).toFixed(2));
    return {
      kind,
      hue,
      scale,
      orbitSpeed: Number((0.75 + i * 0.42 + complexity * 1.1).toFixed(2)),
      reactivity: Number((0.75 + complexity * 0.85 + i * 0.12).toFixed(2)),
    };
  }) as [BrainShapeParams, BrainShapeParams, BrainShapeParams];

  return {
    seed: trimmed || encodeKolmogorov({ complexity, jankLevel, bodyHue, accentHue, shapes }),
    complexity,
    jankLevel,
    bodyHue,
    accentHue,
    shapes,
  };
}

export function generateRandomKolmogorovBrain(): KolmogorovBrain {
  const rng = Math.random;
  // Harmonious twilight crystal palettes (amber, seafoam, opal, amethyst, coral)
  const paletteRoots = [16, 38, 178, 206, 282, 336];
  const rootHue = paletteRoots[Math.floor(rng() * paletteRoots.length)];
  const complexity = Number((0.35 + rng() * 0.55).toFixed(2));
  const jankLevel = Number((0.55 + rng() * 0.4).toFixed(2));
  const bodyHue = (rootHue + 190 + Math.floor(rng() * 3) * 15) % 360;
  const accentHue = (rootHue + 20) % 360;

  const pickedKinds: BrainShapeKind[] = [];
  while (pickedKinds.length < 3) {
    const k = BRAIN_SHAPE_KINDS[Math.floor(rng() * BRAIN_SHAPE_KINDS.length)];
    if (!pickedKinds.includes(k)) pickedKinds.push(k);
  }

  const hueSpread = [0, 125, 245];
  const shapes: [BrainShapeParams, BrainShapeParams, BrainShapeParams] = [0, 1, 2].map((i) => ({
    kind: pickedKinds[i],
    hue: (rootHue + hueSpread[i] + Math.floor(rng() * 24)) % 360,
    scale: Number((0.8 + rng() * 0.4).toFixed(2)),
    orbitSpeed: Number((0.75 + i * 0.42 + complexity * 1.1).toFixed(2)),
    reactivity: Number((0.8 + complexity * 0.75 + i * 0.12).toFixed(2)),
  })) as [BrainShapeParams, BrainShapeParams, BrainShapeParams];

  const seed = encodeKolmogorov({ complexity, jankLevel, bodyHue, accentHue, shapes });
  return {
    seed,
    complexity,
    jankLevel,
    bodyHue,
    accentHue,
    shapes,
  };
}

const CUBE_PREFIXES = ['Kubo', 'Vex', 'Mino', 'Piko', 'Trio', 'Zed', 'Luma', 'Sora', 'Noko', 'Brix'];

export function createSpawnCharacter(
  ownerId: string,
  brain?: KolmogorovBrain,
  instrument?: {
    role: InstrumentRole;
    variant: string;
    steps: number[];
    notes?: Array<number | null>;
    gain?: number;
    muted?: boolean;
    label?: string;
    id?: string;
    orbitRadius?: number;
    orbitAngle?: number;
  }
): CharacterState {
  const b = brain ?? generateRandomKolmogorovBrain();
  const id = instrument?.id ?? `cube-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const prefix = CUBE_PREFIXES[Math.floor(Math.random() * CUBE_PREFIXES.length)];
  const num = Math.floor(10 + Math.random() * 89);
  const role: InstrumentRole = instrument?.role ?? 'melody';
  const variant = instrument?.variant ?? 'fae-bell';
  const steps = instrument?.steps ?? [0.85, 0, 0.7, 0, 0, 0.8, 0, 0.65, 0.9, 0, 0, 0.75, 0, 0.8, 0.85, 0];
  const isSinger = role === 'bass' || role === 'melody' || role === 'harmony';
  const spawnAngle = instrument?.orbitAngle ?? Math.random() * Math.PI * 2;
  const orbitRadius = instrument?.orbitRadius ?? (isSinger ? 9.15 : 7.55) + (Math.random() - 0.5) * 0.4;
  const spawnDist = orbitRadius;

  return {
    id,
    ownerId,
    label: instrument?.label ?? `${prefix}-${num}`,
    role,
    variant,
    steps: [...steps],
    ...(instrument?.notes ? { notes: [...instrument.notes] } : {}),
    gain: instrument?.gain ?? 0.82,
    muted: instrument?.muted ?? false,
    x: Number((Math.cos(spawnAngle) * spawnDist).toFixed(2)),
    y: 0,
    z: Number((Math.sin(spawnAngle) * spawnDist).toFixed(2)),
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: Math.atan2(-Math.sin(spawnAngle), Math.cos(spawnAngle)),
    mode: 'abandoned',
    orbitRadius,
    orbitAngle: spawnAngle,
    orbitSpeed: 0.44,
    orbitDir: 1,
    bootAt: Date.now(),
    brain: b,
    moving: true,
  };
}
