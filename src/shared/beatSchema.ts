import {
  KolmogorovBrain,
  SnapBand,
  VfxTriggerMode,
  decodeKolmogorov,
  sanitizeFriendlyLabel,
} from './protocol';

export type DrumRole = 'kick' | 'snare' | 'hat' | 'perc';
export type SingerRole = 'bass' | 'melody' | 'harmony';
export type InstrumentRole = DrumRole | SingerRole;

export const DRUM_ROLES: DrumRole[] = ['kick', 'snare', 'hat', 'perc'];
export const SINGER_ROLES: SingerRole[] = ['bass', 'melody', 'harmony'];
export const INSTRUMENT_ROLES: InstrumentRole[] = [...DRUM_ROLES, ...SINGER_ROLES];

export const INSTRUMENT_ROLE_LABELS: Record<InstrumentRole, string> = {
  kick: 'Kick',
  snare: 'Snare',
  hat: 'Shaker',
  perc: 'Kalimba',
  bass: 'Bass',
  melody: 'Melody',
  harmony: 'Choir',
};

export interface VariantOption {
  id: string;
  label: string;
}

export const ROLE_VARIANTS: Record<InstrumentRole, VariantOption[]> = {
  kick: [
    { id: 'warm-sub', label: 'Warm Kick' },
    { id: '808-bloom', label: 'Deep Boom' },
    { id: 'hearth-thump', label: 'Soft Thump' },
  ],
  snare: [
    { id: 'wood-rim', label: 'Wood Rim' },
    { id: 'brush-snap', label: 'Soft Brush' },
    { id: 'tape-crack', label: 'Crisp Snap' },
  ],
  hat: [
    { id: 'crystal-tick', label: 'Light Tick' },
    { id: 'moss-shaker', label: 'Leaf Shaker' },
    { id: 'open-shimmer', label: 'Open Hat' },
  ],
  perc: [
    { id: 'kalimba-wood', label: 'Thumb Piano' },
    { id: 'ember-tom', label: 'Warm Tom' },
    { id: 'chime-conga', label: 'Wood Conga' },
  ],
  bass: [
    { id: 'zimmer-cello', label: 'Warm Cello' },
    { id: 'analog-sub', label: 'Round Bass' },
    { id: 'moss-drone', label: 'Deep Hum' },
  ],
  melody: [
    { id: 'fae-bell', label: 'Music Box' },
    { id: 'glass-flute', label: 'Soft Flute' },
    { id: 'tycho-rhodes', label: 'Warm Keys' },
  ],
  harmony: [
    { id: 'choir-pad', label: 'Soft Choir' },
    { id: 'quartz-arp', label: 'Pluck Pluck' },
    { id: 'warm-brass', label: 'Warm Horns' },
  ],
};

export type MusicalScaleId = 'D-lydian' | 'A-minor' | 'F-major' | 'E-dorian' | 'C-pentatonic';

export const MUSICAL_SCALE_LABELS: Record<MusicalScaleId, string> = {
  'C-pentatonic': 'Easy 5-Note',
  'D-lydian': 'Dreamy',
  'F-major': 'Sunny Major',
  'A-minor': 'Cozy Minor',
  'E-dorian': 'Night Walk',
};

// Semitone offsets from root MIDI pitch
export const SCALE_INTERVALS: Record<MusicalScaleId, { rootMidi: number; intervals: number[] }> = {
  'D-lydian': { rootMidi: 50, intervals: [0, 2, 4, 6, 7, 9, 11] },
  'A-minor': { rootMidi: 45, intervals: [0, 2, 3, 5, 7, 8, 10] },
  'F-major': { rootMidi: 41, intervals: [0, 2, 4, 5, 7, 9, 11] },
  'E-dorian': { rootMidi: 40, intervals: [0, 2, 3, 5, 7, 9, 10] },
  'C-pentatonic': { rootMidi: 48, intervals: [0, 2, 4, 7, 9] },
};

export const DREI_STAR_HUES: Record<SingerRole, number> = {
  bass: 38,     // Warm gold
  melody: 176,  // Bright aqua
  harmony: 278, // Soft violet
};

export const MIN_BPM = 60;
export const MAX_BPM = 180;
export const DEFAULT_BPM = 102;

/**
 * BPM-coupled walking animation rate:
 * 12 quantized animation frames per quarter beat (24 FPS at 120 BPM).
 */
export function bpmToAnimFps(bpm: number): number {
  const clamped = Math.max(MIN_BPM, Math.min(MAX_BPM, bpm));
  return Number((clamped * 0.2).toFixed(1));
}

export function isSingerRole(role: InstrumentRole): role is SingerRole {
  return role === 'bass' || role === 'melody' || role === 'harmony';
}

export function isDrumRole(role: InstrumentRole): role is DrumRole {
  return role === 'kick' || role === 'snare' || role === 'hat' || role === 'perc';
}

export function getDefaultVariantForRole(role: InstrumentRole): string {
  return ROLE_VARIANTS[role][0].id;
}

export function isValidVariantForRole(role: InstrumentRole, variant: string): boolean {
  return ROLE_VARIANTS[role].some((v) => v.id === variant);
}

export interface BeatMarcherVisuals {
  snapBand?: SnapBand;
  snapThreshold?: number;
  vfxTriggerMode?: VfxTriggerMode;
}

export interface BeatMarcherSpec {
  id: string;
  label: string;
  role: InstrumentRole;
  variant: string;
  muted: boolean;
  gain: number; // 0.1..1.2
  steps: number[]; // length 16, each 0..1 (0 = rest, >0 = velocity)
  notes?: Array<number | null>; // length 16, optional MIDI pitch (24..108) for singers
  seed: string; // Simple lowercase recipe or phrase
  visuals?: BeatMarcherVisuals;
}

export interface BeatDocument {
  version: '1.0';
  title: string;
  bpm: number; // 60..180
  scale: MusicalScaleId;
  marchers: BeatMarcherSpec[];
}

export function getDefaultStepsForRole(role: InstrumentRole): number[] {
  switch (role) {
    case 'kick':
      return [1, 0, 0, 0, 0.85, 0, 0, 0, 1, 0, 0, 0, 0.85, 0, 0.72, 0];
    case 'snare':
      return [0, 0, 0, 0, 0.92, 0, 0, 0.32, 0, 0, 0, 0, 0.95, 0, 0, 0.36];
    case 'hat':
      return [0.7, 0.35, 0.85, 0.35, 0.7, 0.35, 0.9, 0.4, 0.7, 0.35, 0.85, 0.35, 0.7, 0.45, 0.95, 0.4];
    case 'perc':
      return [0, 0, 0.65, 0, 0, 0.55, 0, 0, 0, 0, 0.7, 0, 0, 0.48, 0.82, 0];
    case 'bass':
      return [0.95, 0, 0, 0.55, 0, 0, 0.78, 0, 0.9, 0, 0, 0.52, 0, 0, 0.82, 0];
    case 'melody':
      return [0.9, 0, 0.72, 0, 0, 0.84, 0, 0.65, 0.92, 0, 0, 0.75, 0, 0.8, 0.88, 0];
    case 'harmony':
      return [0.85, 0, 0, 0, 0, 0, 0.62, 0, 0.82, 0, 0, 0, 0, 0, 0.7, 0];
  }
}

export function getDefaultNotesForRole(role: InstrumentRole): Array<number | null> | undefined {
  switch (role) {
    case 'bass':
      return [38, null, null, 38, null, null, 45, null, 43, null, null, 43, null, null, 45, null];
    case 'melody':
      return [62, null, 66, null, null, 69, null, 73, 74, null, null, 73, null, 69, 66, null];
    case 'harmony':
      return [54, null, null, null, null, null, 57, null, 59, null, null, null, null, null, 61, null];
    default:
      return undefined;
  }
}

export function getDefaultSeedForRole(role: InstrumentRole): string {
  switch (role) {
    case 'kick':
      return 'coral.pyramid-gold.ring-berry.diamond';
    case 'snare':
      return 'mint.diamond-sky.prism-gold.cone';
    case 'hat':
      return 'lime.star-aqua.gem-gold.ring';
    case 'perc':
      return 'gold.cone-coral.ribbon-mint.gem';
    case 'bass':
      return 'gold.gem-coral.ring-lime.pyramid';
    case 'melody':
      return 'aqua.star-sky.diamond-mint.ribbon';
    case 'harmony':
      return 'violet.ring-berry.star-sky.gem';
  }
}

export const DEFAULT_BEAT_DOCUMENT: BeatDocument = {
  version: '1.0',
  title: 'Campfire Jam',
  bpm: DEFAULT_BPM,
  scale: 'D-lydian',
  marchers: [
    {
      id: 'marcher-kick',
      label: 'Kick',
      role: 'kick',
      variant: 'warm-sub',
      muted: false,
      gain: 0.92,
      steps: [1, 0, 0, 0, 0.82, 0, 0, 0, 1, 0, 0, 0, 0.85, 0, 0.72, 0],
      seed: 'coral.pyramid-gold.ring-berry.diamond',
      visuals: { snapBand: 'bass', snapThreshold: 0.45, vfxTriggerMode: 'on-beat' },
    },
    {
      id: 'marcher-snare',
      label: 'Snare',
      role: 'snare',
      variant: 'wood-rim',
      muted: false,
      gain: 0.82,
      steps: [0, 0, 0, 0, 0.92, 0, 0, 0.3, 0, 0, 0, 0, 0.95, 0, 0, 0.35],
      seed: 'mint.diamond-sky.prism-gold.cone',
      visuals: { snapBand: 'mid', snapThreshold: 0.5, vfxTriggerMode: 'on-beat' },
    },
    {
      id: 'marcher-hat',
      label: 'Shaker',
      role: 'hat',
      variant: 'crystal-tick',
      muted: false,
      gain: 0.66,
      steps: [0.7, 0.32, 0.86, 0.32, 0.7, 0.32, 0.9, 0.38, 0.7, 0.32, 0.86, 0.32, 0.7, 0.42, 0.94, 0.38],
      seed: 'lime.star-aqua.gem-gold.ring',
      visuals: { snapBand: 'treble', snapThreshold: 0.46, vfxTriggerMode: 'single' },
    },
    {
      id: 'marcher-perc',
      label: 'Kalimba',
      role: 'perc',
      variant: 'kalimba-wood',
      muted: false,
      gain: 0.74,
      steps: [0, 0, 0.62, 0, 0, 0.55, 0, 0, 0, 0, 0.68, 0, 0, 0.5, 0.82, 0],
      seed: 'gold.cone-coral.ribbon-mint.gem',
      visuals: { snapBand: 'mid', snapThreshold: 0.52, vfxTriggerMode: 'on-beat' },
    },
    {
      id: 'marcher-bass',
      label: 'Bass',
      role: 'bass',
      variant: 'zimmer-cello',
      muted: false,
      gain: 0.88,
      steps: [0.95, 0, 0, 0.55, 0, 0, 0.78, 0, 0.9, 0, 0, 0.52, 0, 0, 0.84, 0],
      notes: [38, null, null, 38, null, null, 45, null, 43, null, null, 43, null, null, 45, null],
      seed: 'gold.gem-coral.ring-lime.pyramid',
      visuals: { snapBand: 'bass', snapThreshold: 0.44, vfxTriggerMode: 'on-beat' },
    },
    {
      id: 'marcher-melody',
      label: 'Melody',
      role: 'melody',
      variant: 'fae-bell',
      muted: false,
      gain: 0.8,
      steps: [0.88, 0, 0.7, 0, 0, 0.82, 0, 0.64, 0.92, 0, 0, 0.72, 0, 0.78, 0.9, 0],
      notes: [62, null, 66, null, null, 69, null, 73, 74, null, null, 73, null, 69, 66, null],
      seed: 'aqua.star-sky.diamond-mint.ribbon',
      visuals: { snapBand: 'treble', snapThreshold: 0.48, vfxTriggerMode: 'on-beat' },
    },
    {
      id: 'marcher-harmony',
      label: 'Choir',
      role: 'harmony',
      variant: 'choir-pad',
      muted: false,
      gain: 0.75,
      steps: [0.85, 0, 0, 0, 0, 0, 0.65, 0, 0.84, 0, 0, 0, 0, 0, 0.74, 0],
      notes: [54, null, null, null, null, null, 57, null, 59, null, null, null, null, null, 61, null],
      seed: 'violet.ring-berry.star-sky.gem',
      visuals: { snapBand: 'mid', snapThreshold: 0.5, vfxTriggerMode: 'on-beat' },
    },
  ],
};

export const BEAT_PRESETS: Record<string, BeatDocument> = {
  'campfire-jam': DEFAULT_BEAT_DOCUMENT,
  'night-stroll': {
    version: '1.0',
    title: 'Night Stroll',
    bpm: 120,
    scale: 'E-dorian',
    marchers: [
      {
        id: 'marcher-kick',
        label: 'Kick',
        role: 'kick',
        variant: '808-bloom',
        muted: false,
        gain: 0.96,
        steps: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.75, 0],
        seed: 'coral.diamond-gold.ring-sky.pyramid',
        visuals: { snapBand: 'bass', snapThreshold: 0.42, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-snare',
        label: 'Snare',
        role: 'snare',
        variant: 'tape-crack',
        muted: false,
        gain: 0.85,
        steps: [0, 0, 0, 0, 0.95, 0, 0, 0, 0, 0, 0, 0, 0.95, 0, 0, 0.5],
        seed: 'sky.prism-mint.diamond-berry.cone',
        visuals: { snapBand: 'mid', snapThreshold: 0.48, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-hat',
        label: 'Shaker',
        role: 'hat',
        variant: 'open-shimmer',
        muted: false,
        gain: 0.68,
        steps: [0.45, 0.35, 0.95, 0.35, 0.45, 0.35, 0.95, 0.45, 0.45, 0.35, 0.95, 0.35, 0.45, 0.5, 1, 0.4],
        seed: 'aqua.star-lime.ring-sky.gem',
        visuals: { snapBand: 'treble', snapThreshold: 0.44, vfxTriggerMode: 'single' },
      },
      {
        id: 'marcher-perc',
        label: 'Kalimba',
        role: 'perc',
        variant: 'chime-conga',
        muted: false,
        gain: 0.76,
        steps: [0, 0.6, 0, 0.75, 0, 0, 0.65, 0, 0, 0.6, 0, 0.8, 0, 0.55, 0, 0.7],
        seed: 'berry.cone-gold.gem-mint.prism',
        visuals: { snapBand: 'mid', snapThreshold: 0.5, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-bass',
        label: 'Bass',
        role: 'bass',
        variant: 'analog-sub',
        muted: false,
        gain: 0.92,
        steps: [1, 0, 0.65, 0, 0, 0.7, 0.85, 0, 1, 0, 0.65, 0, 0, 0.75, 0.9, 0],
        notes: [40, null, 40, null, null, 43, 45, null, 47, null, 45, null, null, 43, 42, null],
        seed: 'gold.pyramid-coral.gem-mint.ring',
        visuals: { snapBand: 'bass', snapThreshold: 0.42, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-melody',
        label: 'Melody',
        role: 'melody',
        variant: 'tycho-rhodes',
        muted: false,
        gain: 0.82,
        steps: [0.9, 0, 0, 0.76, 0, 0, 0.84, 0, 0.92, 0, 0.72, 0, 0.86, 0, 0.78, 0],
        notes: [64, null, null, 67, null, null, 71, null, 74, null, 71, null, 69, null, 67, null],
        seed: 'aqua.gem-sky.star-violet.ribbon',
        visuals: { snapBand: 'treble', snapThreshold: 0.45, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-harmony',
        label: 'Choir',
        role: 'harmony',
        variant: 'quartz-arp',
        muted: false,
        gain: 0.78,
        steps: [0.8, 0, 0.6, 0, 0.72, 0, 0.6, 0, 0.82, 0, 0.6, 0, 0.75, 0, 0.85, 0],
        notes: [55, null, 59, null, 62, null, 59, null, 57, null, 61, null, 64, null, 62, null],
        seed: 'violet.star-berry.ring-aqua.diamond',
        visuals: { snapBand: 'mid', snapThreshold: 0.48, vfxTriggerMode: 'on-beat' },
      },
    ],
  },
  'rainy-moss': {
    version: '1.0',
    title: 'Rainy Moss',
    bpm: 84,
    scale: 'C-pentatonic',
    marchers: [
      {
        id: 'marcher-kick',
        label: 'Kick',
        role: 'kick',
        variant: 'hearth-thump',
        muted: false,
        gain: 0.94,
        steps: [1, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0.88, 0, 0, 0, 0.65, 0],
        seed: 'mossy-pebble',
        visuals: { snapBand: 'bass', snapThreshold: 0.46, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-snare',
        label: 'Snare',
        role: 'snare',
        variant: 'brush-snap',
        muted: false,
        gain: 0.86,
        steps: [0, 0, 0, 0, 0, 0, 0, 0, 0.96, 0, 0, 0, 0, 0, 0, 0.42],
        seed: 'sleepy-fern',
        visuals: { snapBand: 'mid', snapThreshold: 0.48, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-hat',
        label: 'Shaker',
        role: 'hat',
        variant: 'moss-shaker',
        muted: false,
        gain: 0.7,
        steps: [0.65, 0.25, 0.72, 0.3, 0.65, 0.25, 0.8, 0.42, 0.65, 0.25, 0.72, 0.3, 0.65, 0.4, 0.88, 0.35],
        seed: 'misty-brook',
        visuals: { snapBand: 'treble', snapThreshold: 0.5, vfxTriggerMode: 'single' },
      },
      {
        id: 'marcher-perc',
        label: 'Kalimba',
        role: 'perc',
        variant: 'ember-tom',
        muted: false,
        gain: 0.72,
        steps: [0, 0, 0, 0.62, 0, 0, 0, 0, 0, 0, 0, 0.68, 0, 0.55, 0, 0],
        seed: 'cozy-acorn',
        visuals: { snapBand: 'mid', snapThreshold: 0.52, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-bass',
        label: 'Bass',
        role: 'bass',
        variant: 'moss-drone',
        muted: false,
        gain: 0.9,
        steps: [0.95, 0, 0, 0, 0, 0, 0.75, 0, 0.88, 0, 0, 0, 0, 0, 0.7, 0],
        notes: [36, null, null, null, null, null, 38, null, 43, null, null, null, null, null, 40, null],
        seed: 'gold.ring-mint.gem-sky.pyramid',
        visuals: { snapBand: 'bass', snapThreshold: 0.44, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-melody',
        label: 'Melody',
        role: 'melody',
        variant: 'glass-flute',
        muted: false,
        gain: 0.84,
        steps: [0.85, 0, 0, 0.7, 0, 0.8, 0, 0, 0.9, 0, 0.68, 0, 0, 0.78, 0, 0.72],
        notes: [60, null, null, 62, null, 64, null, null, 67, null, 69, null, null, 67, null, 64],
        seed: 'aqua.ribbon-mint.star-sky.gem',
        visuals: { snapBand: 'treble', snapThreshold: 0.48, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-harmony',
        label: 'Choir',
        role: 'harmony',
        variant: 'warm-brass',
        muted: false,
        gain: 0.78,
        steps: [0.85, 0, 0, 0, 0, 0, 0, 0, 0.82, 0, 0, 0, 0, 0, 0.65, 0],
        notes: [52, null, null, null, null, null, null, null, 55, null, null, null, null, null, 57, null],
        seed: 'violet.gem-berry.ribbon-sky.ring',
        visuals: { snapBand: 'mid', snapThreshold: 0.5, vfxTriggerMode: 'on-beat' },
      },
    ],
  },
};

export interface BeatValidationResult {
  ok: boolean;
  document?: BeatDocument;
  errors: string[];
}

export function normalizeSteps16(raw: unknown, fallback: number[]): number[] {
  if (!Array.isArray(raw)) return [...fallback];
  const out: number[] = [];
  for (let i = 0; i < 16; i++) {
    const val = Number(raw[i] ?? 0);
    out.push(Number.isFinite(val) ? Number(Math.max(0, Math.min(1, val)).toFixed(2)) : 0);
  }
  return out;
}

export function normalizeNotes16(raw: unknown, role: InstrumentRole): Array<number | null> | undefined {
  if (!isSingerRole(role)) return undefined;
  const fallback = getDefaultNotesForRole(role) ?? new Array<number | null>(16).fill(null);
  if (!Array.isArray(raw)) return [...fallback];
  const out: Array<number | null> = [];
  for (let i = 0; i < 16; i++) {
    const item = raw[i];
    if (item === null || item === undefined || item === '') {
      out.push(null);
    } else {
      const n = Math.round(Number(item));
      out.push(Number.isFinite(n) ? Math.max(24, Math.min(108, n)) : null);
    }
  }
  return out;
}

export function validateBeatDocument(input: unknown): BeatValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['Root beat payload must be a JSON object.'] };
  }

  const obj = input as Record<string, unknown>;
  const rawBpm = Number(obj.bpm ?? DEFAULT_BPM);
  if (!Number.isFinite(rawBpm)) {
    errors.push('bpm must be a finite number between 60 and 180.');
  }
  const bpm = Math.round(Math.max(MIN_BPM, Math.min(MAX_BPM, Number.isFinite(rawBpm) ? rawBpm : DEFAULT_BPM)));

  const rawScale = typeof obj.scale === 'string' ? obj.scale : 'D-lydian';
  const scale: MusicalScaleId = (
    ['D-lydian', 'A-minor', 'F-major', 'E-dorian', 'C-pentatonic'].includes(rawScale)
      ? rawScale
      : 'D-lydian'
  ) as MusicalScaleId;

  const title = sanitizeFriendlyLabel(
    typeof obj.title === 'string' ? obj.title : undefined,
    'Campfire Jam'
  );

  if (!Array.isArray(obj.marchers) || obj.marchers.length === 0) {
    errors.push('marchers must be a non-empty array (1 to 16 marchers).');
    return { ok: false, errors };
  }

  const marchers: BeatMarcherSpec[] = [];
  const usedIds = new Set<string>();

  for (let idx = 0; idx < Math.min(16, obj.marchers.length); idx++) {
    const item = obj.marchers[idx];
    if (!item || typeof item !== 'object') {
      errors.push(`marchers[${idx}] must be an object.`);
      continue;
    }
    const m = item as Record<string, unknown>;
    const rawRole = String(m.role ?? '');
    if (!INSTRUMENT_ROLES.includes(rawRole as InstrumentRole)) {
      errors.push(`marchers[${idx}].role "${rawRole}" must be one of: ${INSTRUMENT_ROLES.join(', ')}.`);
      continue;
    }
    const role = rawRole as InstrumentRole;
    const rawVariant = typeof m.variant === 'string' ? m.variant : getDefaultVariantForRole(role);
    const variant = isValidVariantForRole(role, rawVariant) ? rawVariant : getDefaultVariantForRole(role);

    let id =
      typeof m.id === 'string' && m.id.trim().length > 0
        ? m.id.trim().slice(0, 40)
        : `marcher-${role}-${idx + 1}`;
    if (usedIds.has(id)) {
      id = `${id}-${idx + 1}`;
    }
    usedIds.add(id);

    const label = sanitizeFriendlyLabel(
      typeof m.label === 'string' ? m.label : undefined,
      INSTRUMENT_ROLE_LABELS[role]
    );

    const rawGain = Number(m.gain ?? 0.82);
    const gain = Number(Math.max(0.1, Math.min(1.2, Number.isFinite(rawGain) ? rawGain : 0.82)).toFixed(2));
    const muted = Boolean(m.muted);
    const steps = normalizeSteps16(m.steps, getDefaultStepsForRole(role));
    const notes = normalizeNotes16(m.notes, role);
    const seed =
      typeof m.seed === 'string' && m.seed.trim().length > 0
        ? m.seed.trim().toLowerCase().slice(0, 48)
        : getDefaultSeedForRole(role);

    let visuals: BeatMarcherVisuals | undefined;
    if (m.visuals && typeof m.visuals === 'object') {
      const v = m.visuals as Record<string, unknown>;
      const snapBand =
        v.snapBand === 'bass' || v.snapBand === 'mid' || v.snapBand === 'treble' ? v.snapBand : undefined;
      const snapThreshold =
        typeof v.snapThreshold === 'number' && Number.isFinite(v.snapThreshold)
          ? Number(Math.max(0.12, Math.min(0.92, v.snapThreshold)).toFixed(2))
          : undefined;
      const vfxTriggerMode =
        v.vfxTriggerMode === 'on-beat' || v.vfxTriggerMode === 'single' ? v.vfxTriggerMode : undefined;
      visuals = { snapBand, snapThreshold, vfxTriggerMode };
    }

    marchers.push({
      id,
      label,
      role,
      variant,
      muted,
      gain,
      steps,
      ...(notes ? { notes } : {}),
      seed,
      ...(visuals ? { visuals } : {}),
    });
  }

  if (marchers.length === 0) {
    return { ok: false, errors: errors.length > 0 ? errors : ['No valid marchers found in beat JSON.'] };
  }

  return {
    ok: errors.length === 0,
    document: {
      version: '1.0',
      title,
      bpm,
      scale,
      marchers,
    },
    errors,
  };
}

export function buildBrainFromBeatMarcher(spec: BeatMarcherSpec): KolmogorovBrain {
  const base = decodeKolmogorov(spec.seed);
  if (isSingerRole(spec.role)) {
    base.accentHue = DREI_STAR_HUES[spec.role];
  }
  return {
    ...base,
    snapBand:
      spec.visuals?.snapBand ??
      (spec.role === 'kick' || spec.role === 'bass'
        ? 'bass'
        : spec.role === 'hat' || spec.role === 'melody'
          ? 'treble'
          : 'mid'),
    snapThreshold: spec.visuals?.snapThreshold ?? 0.48,
    vfxTriggerMode: spec.visuals?.vfxTriggerMode ?? 'on-beat',
  };
}

/**
 * Converts a BeatDocument into evenly spaced inner-drum & outer-singer CharacterStates.
 */
export function buildCharactersFromBeatDocument(
  doc: BeatDocument,
  bootOffsetMs = 0
): import('./protocol').CharacterState[] {
  const drums = doc.marchers.filter((m) => isDrumRole(m.role));
  const singers = doc.marchers.filter((m) => isSingerRole(m.role));
  const now = Date.now() + bootOffsetMs;

  const drumAngleMap = new Map<string, { angle: number; radius: number }>();
  drums.forEach((d, idx) => {
    const angle = (idx / Math.max(1, drums.length)) * Math.PI * 2 + 0.35;
    drumAngleMap.set(d.id, { angle, radius: 7.45 + (idx % 2 === 0 ? -0.2 : 0.22) });
  });

  const singerAngleMap = new Map<string, { angle: number; radius: number }>();
  singers.forEach((s, idx) => {
    const angle = (idx / Math.max(1, singers.length)) * Math.PI * 2 + 0.85;
    singerAngleMap.set(s.id, { angle, radius: 9.2 + (idx % 2 === 0 ? 0.15 : -0.15) });
  });

  return doc.marchers.map((spec) => {
    const slot = drumAngleMap.get(spec.id) ?? singerAngleMap.get(spec.id) ?? { angle: 0, radius: 8.4 };
    const x = Number((Math.cos(slot.angle) * slot.radius).toFixed(2));
    const z = Number((Math.sin(slot.angle) * slot.radius).toFixed(2));
    const yaw = Math.atan2(-Math.sin(slot.angle), Math.cos(slot.angle));

    return {
      id: spec.id,
      ownerId: null,
      label: sanitizeFriendlyLabel(spec.label, INSTRUMENT_ROLE_LABELS[spec.role]),
      role: spec.role,
      variant: spec.variant,
      steps: [...spec.steps],
      ...(spec.notes ? { notes: [...spec.notes] } : {}),
      gain: spec.gain,
      muted: spec.muted,
      x,
      y: 0,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw,
      mode: 'abandoned',
      orbitRadius: slot.radius,
      orbitAngle: slot.angle,
      orbitSpeed: isSingerRole(spec.role) ? 0.38 : 0.46,
      orbitDir: 1,
      bootAt: now,
      brain: buildBrainFromBeatMarcher(spec),
      moving: true,
    };
  });
}

export function exportBeatDocumentFromCharacters(
  characters: Iterable<import('./protocol').CharacterState>,
  bpm: number,
  scale: MusicalScaleId,
  title = 'Campfire Jam'
): BeatDocument {
  const marchers: BeatMarcherSpec[] = [];
  for (const ch of characters) {
    marchers.push({
      id: ch.id,
      label: sanitizeFriendlyLabel(ch.label, INSTRUMENT_ROLE_LABELS[ch.role]),
      role: ch.role,
      variant: ch.variant,
      muted: ch.muted,
      gain: ch.gain,
      steps: [...ch.steps],
      ...(ch.notes ? { notes: [...ch.notes] } : {}),
      seed: ch.brain.seed,
      visuals: {
        snapBand: ch.brain.snapBand ?? 'bass',
        snapThreshold: ch.brain.snapThreshold ?? 0.48,
        vfxTriggerMode: ch.brain.vfxTriggerMode ?? 'on-beat',
      },
    });
  }
  return {
    version: '1.0',
    title,
    bpm: Math.round(Math.max(MIN_BPM, Math.min(MAX_BPM, bpm))),
    scale,
    marchers,
  };
}
