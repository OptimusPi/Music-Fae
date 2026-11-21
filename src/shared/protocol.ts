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
  tetra: 'Pyramid',
  octa: 'Diamond',
  icosa: 'Gem',
  torus: 'Ring',
  knot: 'Ribbon',
  dodeca: 'Star',
  cone: 'Cone',
  prism: 'Prism',
};

const SHAPE_SLUG_BY_KIND: Record<BrainShapeKind, string> = {
  tetra: 'pyramid',
  octa: 'diamond',
  icosa: 'gem',
  torus: 'ring',
  knot: 'ribbon',
  dodeca: 'star',
  cone: 'cone',
  prism: 'prism',
};

const KIND_BY_SHAPE_SLUG: Record<string, BrainShapeKind> = {
  pyramid: 'tetra',
  tetra: 'tetra',
  diamond: 'octa',
  octa: 'octa',
  gem: 'icosa',
  icosa: 'icosa',
  ring: 'torus',
  torus: 'torus',
  ribbon: 'knot',
  knot: 'knot',
  star: 'dodeca',
  dodeca: 'dodeca',
  cone: 'cone',
  prism: 'prism',
};

export interface ColorSwatchDef {
  id: string;
  label: string;
  hue: number;
}

export const CUBE_COLOR_SWATCHES: ColorSwatchDef[] = [
  { id: 'gold', label: 'Gold', hue: 38 },
  { id: 'coral', label: 'Coral', hue: 16 },
  { id: 'berry', label: 'Berry', hue: 336 },
  { id: 'violet', label: 'Violet', hue: 278 },
  { id: 'sky', label: 'Sky', hue: 206 },
  { id: 'aqua', label: 'Aqua', hue: 176 },
  { id: 'mint', label: 'Mint', hue: 152 },
  { id: 'lime', label: 'Lime', hue: 96 },
];

function nearestColorSwatch(hue: number): ColorSwatchDef {
  const norm = ((hue % 360) + 360) % 360;
  let best = CUBE_COLOR_SWATCHES[0];
  let bestDist = 999;
  for (const sw of CUBE_COLOR_SWATCHES) {
    const raw = Math.abs(sw.hue - norm);
    const dist = Math.min(raw, 360 - raw);
    if (dist < bestDist) {
      bestDist = dist;
      best = sw;
    }
  }
  return best;
}

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
  jankLevel: number; // 0..1 (PSX retro snap + step bounce)
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
 * Cleans up any legacy shouting ALL-CAPS-HYPHEN labels into gentle, readable names.
 */
export function sanitizeFriendlyLabel(raw: string | undefined | null, fallback: string): string {
  if (!raw || !raw.trim()) return fallback;
  const trimmed = raw.trim().slice(0, 24);
  const letters = trimmed.replace(/[^a-zA-Z]/g, '');
  const isAllCaps = letters.length >= 2 && letters === letters.toUpperCase();
  if (isAllCaps || trimmed.includes('HOLONOMY') || trimmed.includes('DREI-STAR')) {
    return trimmed
      .toLowerCase()
      .replace(/holonomy/g, 'moss')
      .replace(/drei-star-/g, '')
      .split(/[-_\s]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ') || fallback;
  }
  return trimmed;
}

/**
 * Deterministic PRNG (Mulberry32) used to unfold short friendly words
 * into 3 simple shapes + colors inside the Clear Cube head.
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
 * Simple, human-readable modular recipe format:
 *   "gold.pyramid-aqua.ring-violet.star"
 * Each of the 3 parts describes one shape + color inside the Clear Cube (Low, Mid, High).
 */
export function encodeKolmogorov(brain: Omit<KolmogorovBrain, 'seed'>): string {
  return brain.shapes
    .map((sp) => `${nearestColorSwatch(sp.hue).id}.${SHAPE_SLUG_BY_KIND[sp.kind]}`)
    .join('-');
}

export function decodeKolmogorov(rawSeed: string): KolmogorovBrain {
  const cleaned = (rawSeed || '')
    .trim()
    .toLowerCase()
    .replace(/holonomy/g, 'moss')
    .replace(/^k3:/, '');

  // Check if it matches the modular 3-part "color.shape-color.shape-color.shape" recipe
  const parts = cleaned.split('-');
  if (parts.length === 3 && parts.every((p) => p.includes('.'))) {
    const parsedShapes = parts.map((part, i) => {
      const [colorId, shapeSlug] = part.split('.');
      const swatch = CUBE_COLOR_SWATCHES.find((c) => c.id === colorId) ?? CUBE_COLOR_SWATCHES[i * 2];
      const kind = KIND_BY_SHAPE_SLUG[shapeSlug] ?? BRAIN_SHAPE_KINDS[i];
      return {
        kind,
        hue: swatch.hue,
        scale: 0.92,
        orbitSpeed: Number((0.85 + i * 0.4).toFixed(2)),
        reactivity: Number((0.95 + i * 0.15).toFixed(2)),
      };
    }) as [BrainShapeParams, BrainShapeParams, BrainShapeParams];

    const accentHue = parsedShapes[0].hue;
    const bodyHue = (accentHue + 195) % 360;
    return {
      seed: cleaned,
      complexity: 0.5,
      jankLevel: 0.6,
      bodyHue,
      accentHue,
      shapes: parsedShapes,
    };
  }

  // Any short word or phrase (like "sleepy frog" or "sunny-moss") deterministically builds a 3-shape head
  const safePhrase = cleaned || 'sunny-moss';
  const rng = mulberry32(hashString(safePhrase));
  const rootSwatch = CUBE_COLOR_SWATCHES[Math.floor(rng() * CUBE_COLOR_SWATCHES.length)];
  const complexity = Number((0.35 + rng() * 0.5).toFixed(2));
  const jankLevel = Number((0.45 + rng() * 0.45).toFixed(2));
  const bodyHue = (rootSwatch.hue + 190 + Math.floor(rng() * 3) * 15) % 360;
  const accentHue = rootSwatch.hue;

  const offsets = [0, 120 + Math.floor(rng() * 35), 235 + Math.floor(rng() * 35)];
  const shapes: [BrainShapeParams, BrainShapeParams, BrainShapeParams] = [0, 1, 2].map((i) => {
    const kind = BRAIN_SHAPE_KINDS[Math.floor(rng() * BRAIN_SHAPE_KINDS.length)];
    const hue = nearestColorSwatch((rootSwatch.hue + offsets[i]) % 360).hue;
    const scale = Number((0.82 + rng() * 0.35).toFixed(2));
    return {
      kind,
      hue,
      scale,
      orbitSpeed: Number((0.8 + i * 0.4 + complexity * 0.9).toFixed(2)),
      reactivity: Number((0.85 + complexity * 0.7 + i * 0.12).toFixed(2)),
    };
  }) as [BrainShapeParams, BrainShapeParams, BrainShapeParams];

  return {
    seed: safePhrase,
    complexity,
    jankLevel,
    bodyHue,
    accentHue,
    shapes,
  };
}

const COZY_ADJECTIVES = [
  'sunny',
  'mossy',
  'sleepy',
  'cozy',
  'misty',
  'berry',
  'starry',
  'honey',
  'clover',
  'gentle',
  'peachy',
  'breezy',
];

const COZY_NOUNS = [
  'frog',
  'pebble',
  'lantern',
  'acorn',
  'chime',
  'brook',
  'cloud',
  'moth',
  'fern',
  'sprout',
  'bell',
  'ember',
];

export function generateRandomKolmogorovBrain(): KolmogorovBrain {
  const adj = COZY_ADJECTIVES[Math.floor(Math.random() * COZY_ADJECTIVES.length)];
  const noun = COZY_NOUNS[Math.floor(Math.random() * COZY_NOUNS.length)];
  return decodeKolmogorov(`${adj}-${noun}`);
}

const CUTE_NAMES = ['Kubo', 'Mino', 'Piko', 'Luma', 'Sora', 'Noko', 'Brix', 'Pip', 'Toko', 'Momo'];

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
  const cuteName = CUTE_NAMES[Math.floor(Math.random() * CUTE_NAMES.length)];
  const role: InstrumentRole = instrument?.role ?? 'melody';
  const variant = instrument?.variant ?? 'fae-bell';
  const steps = instrument?.steps ?? [0.85, 0, 0.7, 0, 0, 0.8, 0, 0.65, 0.9, 0, 0, 0.75, 0, 0.8, 0.85, 0];
  const isSinger = role === 'bass' || role === 'melody' || role === 'harmony';
  const spawnAngle = instrument?.orbitAngle ?? Math.random() * Math.PI * 2;
  const orbitRadius = instrument?.orbitRadius ?? (isSinger ? 9.15 : 7.55) + (Math.random() - 0.5) * 0.35;

  return {
    id,
    ownerId,
    label: sanitizeFriendlyLabel(instrument?.label, cuteName),
    role,
    variant,
    steps: [...steps],
    ...(instrument?.notes ? { notes: [...instrument.notes] } : {}),
    gain: instrument?.gain ?? 0.82,
    muted: instrument?.muted ?? false,
    x: Number((Math.cos(spawnAngle) * orbitRadius).toFixed(2)),
    y: 0,
    z: Number((Math.sin(spawnAngle) * orbitRadius).toFixed(2)),
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
