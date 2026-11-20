import {
  KolmogorovBrain,
  SnapBand,
  VfxTriggerMode,
  decodeKolmogorov,
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
  hat: 'Hi-Hat',
  perc: 'Perc',
  bass: 'Bass Singer',
  melody: 'Melody Singer',
  harmony: 'Harmony Singer',
};

export interface VariantOption {
  id: string;
  label: string;
}

export const ROLE_VARIANTS: Record<InstrumentRole, VariantOption[]> = {
  kick: [
    { id: 'warm-sub', label: 'Warm Sub' },
    { id: '808-bloom', label: '808 Bloom' },
    { id: 'hearth-thump', label: 'Hearth Thump' },
  ],
  snare: [
    { id: 'wood-rim', label: 'Wood Rim' },
    { id: 'brush-snap', label: 'Brush Snap' },
    { id: 'tape-crack', label: 'Tape Crack' },
  ],
  hat: [
    { id: 'crystal-tick', label: 'Crystal Tick' },
    { id: 'moss-shaker', label: 'Moss Shaker' },
    { id: 'open-shimmer', label: 'Open Shimmer' },
  ],
  perc: [
    { id: 'ember-tom', label: 'Ember Tom' },
    { id: 'kalimba-wood', label: 'Kalimba Wood' },
    { id: 'chime-conga', label: 'Chime Conga' },
  ],
  bass: [
    { id: 'zimmer-cello', label: 'Zimmer Cello' },
    { id: 'analog-sub', label: 'Analog Sub' },
    { id: 'moss-drone', label: 'Moss Drone' },
  ],
  melody: [
    { id: 'fae-bell', label: 'Fae Bell' },
    { id: 'glass-flute', label: 'Glass Flute' },
    { id: 'tycho-rhodes', label: 'Tycho Rhodes' },
  ],
  harmony: [
    { id: 'choir-pad', label: 'Choir Pad' },
    { id: 'quartz-arp', label: 'Quartz Arp' },
    { id: 'warm-brass', label: 'Warm Brass' },
  ],
};

export type MusicalScaleId = 'D-lydian' | 'A-minor' | 'F-major' | 'E-dorian' | 'C-pentatonic';

export const MUSICAL_SCALE_LABELS: Record<MusicalScaleId, string> = {
  'D-lydian': 'D Lydian',
  'A-minor': 'A Minor',
  'F-major': 'F Major',
  'E-dorian': 'E Dorian',
  'C-pentatonic': 'C Pentatonic',
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
  bass: 38,     // Warm celestial gold
  melody: 176,  // Luminous aquamarine
  harmony: 278, // Twilight amethyst
};

export const MIN_BPM = 60;
export const MAX_BPM = 180;
export const DEFAULT_BPM = 102;

/**
 * Exact BPM-coupled walking animation rate:
 * 12 quantized animation frames per quarter beat = 6 frames per half-beat step
 * => 24.0 FPS at 120 BPM, 20.4 FPS at 102 BPM, 18.0 FPS at 90 BPM, 30.0 FPS at 150 BPM.
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
  seed: string; // Kolmogorov visual brain seed
  visuals?: BeatMarcherVisuals;
}

export interface BeatDocument {
  version: '1.0';
  title: string;
  bpm: number; // 60..180 (controls tempo AND 0.2*bpm walking animation FPS)
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
      return [38, null, null, 38, null, null, 45, null, 43, null, null, 43, null, null, 45, null]; // D2 - A2 - G2 - A2
    case 'melody':
      return [62, null, 66, null, null, 69, null, 73, 74, null, null, 73, null, 69, 66, null]; // D4 F#4 A4 C#5 D5
    case 'harmony':
      return [54, null, null, null, null, null, 57, null, 59, null, null, null, null, null, 61, null]; // F#3 A3 B3 C#4
    default:
      return undefined;
  }
}

export function getDefaultSeedForRole(role: InstrumentRole): string {
  switch (role) {
    case 'kick':
      return 'CRYSTAL-FAE-HEARTH';
    case 'snare':
      return 'MOSS-PRISM-GLADE';
    case 'hat':
      return 'EMBER-HOLONOMY-08';
    case 'perc':
      return 'AMBER-SPORE-TRIAD';
    case 'bass':
      return 'DREI-STAR-GOLD-BASS';
    case 'melody':
      return 'DREI-STAR-AQUA-MEL';
    case 'harmony':
      return 'DREI-STAR-VIOLET-HARM';
  }
}

export const DEFAULT_BEAT_DOCUMENT: BeatDocument = {
  version: '1.0',
  title: 'Drei Stars Hearth',
  bpm: DEFAULT_BPM,
  scale: 'D-lydian',
  marchers: [
    // 4 Drum Marchers (each marcher IS one instrument)
    {
      id: 'marcher-kick',
      label: 'Kick-01',
      role: 'kick',
      variant: 'warm-sub',
      muted: false,
      gain: 0.92,
      steps: [1, 0, 0, 0, 0.82, 0, 0, 0, 1, 0, 0, 0, 0.85, 0, 0.72, 0],
      seed: 'CRYSTAL-FAE-HEARTH',
      visuals: { snapBand: 'bass', snapThreshold: 0.45, vfxTriggerMode: 'on-beat' },
    },
    {
      id: 'marcher-snare',
      label: 'Snare-02',
      role: 'snare',
      variant: 'wood-rim',
      muted: false,
      gain: 0.82,
      steps: [0, 0, 0, 0, 0.92, 0, 0, 0.3, 0, 0, 0, 0, 0.95, 0, 0, 0.35],
      seed: 'MOSS-PRISM-GLADE',
      visuals: { snapBand: 'mid', snapThreshold: 0.5, vfxTriggerMode: 'on-beat' },
    },
    {
      id: 'marcher-hat',
      label: 'Hat-03',
      role: 'hat',
      variant: 'crystal-tick',
      muted: false,
      gain: 0.66,
      steps: [0.7, 0.32, 0.86, 0.32, 0.7, 0.32, 0.9, 0.38, 0.7, 0.32, 0.86, 0.32, 0.7, 0.42, 0.94, 0.38],
      seed: 'EMBER-HOLONOMY-08',
      visuals: { snapBand: 'treble', snapThreshold: 0.46, vfxTriggerMode: 'single' },
    },
    {
      id: 'marcher-perc',
      label: 'Perc-04',
      role: 'perc',
      variant: 'kalimba-wood',
      muted: false,
      gain: 0.74,
      steps: [0, 0, 0.62, 0, 0, 0.55, 0, 0, 0, 0, 0.68, 0, 0, 0.5, 0.82, 0],
      seed: 'AMBER-SPORE-TRIAD',
      visuals: { snapBand: 'mid', snapThreshold: 0.52, vfxTriggerMode: 'on-beat' },
    },
    // 3 Singer Marchers (linked to the Drei Stars overhead)
    {
      id: 'marcher-bass',
      label: 'Bass-Star',
      role: 'bass',
      variant: 'zimmer-cello',
      muted: false,
      gain: 0.88,
      steps: [0.95, 0, 0, 0.55, 0, 0, 0.78, 0, 0.9, 0, 0, 0.52, 0, 0, 0.84, 0],
      notes: [38, null, null, 38, null, null, 45, null, 43, null, null, 43, null, null, 45, null],
      seed: 'DREI-STAR-GOLD-BASS',
      visuals: { snapBand: 'bass', snapThreshold: 0.44, vfxTriggerMode: 'on-beat' },
    },
    {
      id: 'marcher-melody',
      label: 'Melody-Star',
      role: 'melody',
      variant: 'fae-bell',
      muted: false,
      gain: 0.8,
      steps: [0.88, 0, 0.7, 0, 0, 0.82, 0, 0.64, 0.92, 0, 0, 0.72, 0, 0.78, 0.9, 0],
      notes: [62, null, 66, null, null, 69, null, 73, 74, null, null, 73, null, 69, 66, null],
      seed: 'DREI-STAR-AQUA-MEL',
      visuals: { snapBand: 'treble', snapThreshold: 0.48, vfxTriggerMode: 'on-beat' },
    },
    {
      id: 'marcher-harmony',
      label: 'Harmony-Star',
      role: 'harmony',
      variant: 'choir-pad',
      muted: false,
      gain: 0.75,
      steps: [0.85, 0, 0, 0, 0, 0, 0.65, 0, 0.84, 0, 0, 0, 0, 0, 0.74, 0],
      notes: [54, null, null, null, null, null, 57, null, 59, null, null, null, null, null, 61, null],
      seed: 'DREI-STAR-VIOLET-HARM',
      visuals: { snapBand: 'mid', snapThreshold: 0.5, vfxTriggerMode: 'on-beat' },
    },
  ],
};

export const BEAT_PRESETS: Record<string, BeatDocument> = {
  'drei-stars': DEFAULT_BEAT_DOCUMENT,
  'midnight-fae': {
    version: '1.0',
    title: 'Midnight Fae 126',
    bpm: 126,
    scale: 'E-dorian',
    marchers: [
      {
        id: 'marcher-kick',
        label: 'Kick-126',
        role: 'kick',
        variant: '808-bloom',
        muted: false,
        gain: 0.96,
        steps: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.75, 0],
        seed: 'MIDNIGHT-PULSE-01',
        visuals: { snapBand: 'bass', snapThreshold: 0.42, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-snare',
        label: 'Snare-126',
        role: 'snare',
        variant: 'tape-crack',
        muted: false,
        gain: 0.85,
        steps: [0, 0, 0, 0, 0.95, 0, 0, 0, 0, 0, 0, 0, 0.95, 0, 0, 0.5],
        seed: 'MIDNIGHT-CRACK-02',
        visuals: { snapBand: 'mid', snapThreshold: 0.48, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-hat',
        label: 'Hat-126',
        role: 'hat',
        variant: 'open-shimmer',
        muted: false,
        gain: 0.68,
        steps: [0.45, 0.35, 0.95, 0.35, 0.45, 0.35, 0.95, 0.45, 0.45, 0.35, 0.95, 0.35, 0.45, 0.5, 1, 0.4],
        seed: 'MIDNIGHT-GLINT-03',
        visuals: { snapBand: 'treble', snapThreshold: 0.44, vfxTriggerMode: 'single' },
      },
      {
        id: 'marcher-perc',
        label: 'Perc-126',
        role: 'perc',
        variant: 'chime-conga',
        muted: false,
        gain: 0.76,
        steps: [0, 0.6, 0, 0.75, 0, 0, 0.65, 0, 0, 0.6, 0, 0.8, 0, 0.55, 0, 0.7],
        seed: 'MIDNIGHT-TOM-04',
        visuals: { snapBand: 'mid', snapThreshold: 0.5, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-bass',
        label: 'Bass-Star',
        role: 'bass',
        variant: 'analog-sub',
        muted: false,
        gain: 0.92,
        steps: [1, 0, 0.65, 0, 0, 0.7, 0.85, 0, 1, 0, 0.65, 0, 0, 0.75, 0.9, 0],
        notes: [40, null, 40, null, null, 43, 45, null, 47, null, 45, null, null, 43, 42, null],
        seed: 'DREI-STAR-GOLD-126',
        visuals: { snapBand: 'bass', snapThreshold: 0.42, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-melody',
        label: 'Melody-Star',
        role: 'melody',
        variant: 'tycho-rhodes',
        muted: false,
        gain: 0.82,
        steps: [0.9, 0, 0, 0.76, 0, 0, 0.84, 0, 0.92, 0, 0.72, 0, 0.86, 0, 0.78, 0],
        notes: [64, null, null, 67, null, null, 71, null, 74, null, 71, null, 69, null, 67, null],
        seed: 'DREI-STAR-AQUA-126',
        visuals: { snapBand: 'treble', snapThreshold: 0.45, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-harmony',
        label: 'Harmony-Star',
        role: 'harmony',
        variant: 'quartz-arp',
        muted: false,
        gain: 0.78,
        steps: [0.8, 0, 0.6, 0, 0.72, 0, 0.6, 0, 0.82, 0, 0.6, 0, 0.75, 0, 0.85, 0],
        notes: [55, null, 59, null, 62, null, 59, null, 57, null, 61, null, 64, null, 62, null],
        seed: 'DREI-STAR-VIOLET-126',
        visuals: { snapBand: 'mid', snapThreshold: 0.48, vfxTriggerMode: 'on-beat' },
      },
    ],
  },
  'moss-halftime': {
    version: '1.0',
    title: 'Moss Halftime 84',
    bpm: 84,
    scale: 'A-minor',
    marchers: [
      {
        id: 'marcher-kick',
        label: 'Kick-84',
        role: 'kick',
        variant: 'hearth-thump',
        muted: false,
        gain: 0.94,
        steps: [1, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 0.88, 0, 0, 0, 0.65, 0],
        seed: 'MOSS-HEARTH-84',
        visuals: { snapBand: 'bass', snapThreshold: 0.46, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-snare',
        label: 'Snare-84',
        role: 'snare',
        variant: 'brush-snap',
        muted: false,
        gain: 0.86,
        steps: [0, 0, 0, 0, 0, 0, 0, 0, 0.96, 0, 0, 0, 0, 0, 0, 0.42],
        seed: 'MOSS-BRUSH-84',
        visuals: { snapBand: 'mid', snapThreshold: 0.48, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-hat',
        label: 'Hat-84',
        role: 'hat',
        variant: 'moss-shaker',
        muted: false,
        gain: 0.7,
        steps: [0.65, 0.25, 0.72, 0.3, 0.65, 0.25, 0.8, 0.42, 0.65, 0.25, 0.72, 0.3, 0.65, 0.4, 0.88, 0.35],
        seed: 'MOSS-SHAKER-84',
        visuals: { snapBand: 'treble', snapThreshold: 0.5, vfxTriggerMode: 'single' },
      },
      {
        id: 'marcher-perc',
        label: 'Perc-84',
        role: 'perc',
        variant: 'ember-tom',
        muted: false,
        gain: 0.72,
        steps: [0, 0, 0, 0.62, 0, 0, 0, 0, 0, 0, 0, 0.68, 0, 0.55, 0, 0],
        seed: 'MOSS-EMBER-84',
        visuals: { snapBand: 'mid', snapThreshold: 0.52, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-bass',
        label: 'Bass-Star',
        role: 'bass',
        variant: 'moss-drone',
        muted: false,
        gain: 0.9,
        steps: [0.95, 0, 0, 0, 0, 0, 0.75, 0, 0.88, 0, 0, 0, 0, 0, 0.7, 0],
        notes: [33, null, null, null, null, null, 36, null, 40, null, null, null, null, null, 38, null],
        seed: 'DREI-STAR-GOLD-84',
        visuals: { snapBand: 'bass', snapThreshold: 0.44, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-melody',
        label: 'Melody-Star',
        role: 'melody',
        variant: 'glass-flute',
        muted: false,
        gain: 0.84,
        steps: [0.85, 0, 0, 0.7, 0, 0.8, 0, 0, 0.9, 0, 0.68, 0, 0, 0.78, 0, 0.72],
        notes: [69, null, null, 72, null, 76, null, null, 79, null, 76, null, null, 74, null, 72],
        seed: 'DREI-STAR-AQUA-84',
        visuals: { snapBand: 'treble', snapThreshold: 0.48, vfxTriggerMode: 'on-beat' },
      },
      {
        id: 'marcher-harmony',
        label: 'Harmony-Star',
        role: 'harmony',
        variant: 'warm-brass',
        muted: false,
        gain: 0.78,
        steps: [0.85, 0, 0, 0, 0, 0, 0, 0, 0.82, 0, 0, 0, 0, 0, 0.65, 0],
        notes: [57, null, null, null, null, null, null, null, 60, null, null, null, null, null, 55, null],
        seed: 'DREI-STAR-VIOLET-84',
        visuals: { snapBand: 'mid', snapThreshold: 0.5, vfxTriggerMode: 'on-beat' },
      },
    ],
  },
};

/**
 * Formal Draft 2020-12 JSON Schema exposed via WebMCP (`get_beat_schema`) & `/api/beat/schema`
 * so any connected AI model can compose constraint-valid beats & Kolmogorov visuals directly.
 */
export const BEAT_DOCUMENT_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ClearCubeBeatDocument',
  description:
    'Constraint-based 16-step beat + Drei Stars Crystal Fae visual choreography format. BPM directly controls both audio tempo and walking animation FPS (animFps = 0.2 * bpm, with half-beat STEP/step footwork).',
  type: 'object',
  required: ['bpm', 'marchers'],
  properties: {
    version: { type: 'string', enum: ['1.0'], default: '1.0' },
    title: { type: 'string', minLength: 1, maxLength: 48 },
    bpm: {
      type: 'integer',
      minimum: MIN_BPM,
      maximum: MAX_BPM,
      description: 'Tempo in beats per minute. Sets animation rate to 0.2 * bpm FPS (24 FPS at 120 BPM).',
    },
    scale: {
      type: 'string',
      enum: ['D-lydian', 'A-minor', 'F-major', 'E-dorian', 'C-pentatonic'],
      default: 'D-lydian',
    },
    marchers: {
      type: 'array',
      minItems: 1,
      maxItems: 16,
      description:
        'Each marcher is one instrument. Canonical setup: 4 drum marchers (kick, snare, hat, perc) + 3 singer marchers (bass, melody, harmony linked to the Drei Stars).',
      items: {
        type: 'object',
        required: ['role', 'steps'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 40 },
          label: { type: 'string', minLength: 1, maxLength: 24 },
          role: {
            type: 'string',
            enum: INSTRUMENT_ROLES,
          },
          variant: {
            type: 'string',
            description:
              'Sound variant for the chosen role. kick: warm-sub|808-bloom|hearth-thump; snare: wood-rim|brush-snap|tape-crack; hat: crystal-tick|moss-shaker|open-shimmer; perc: ember-tom|kalimba-wood|chime-conga; bass: zimmer-cello|analog-sub|moss-drone; melody: fae-bell|glass-flute|tycho-rhodes; harmony: choir-pad|quartz-arp|warm-brass.',
          },
          muted: { type: 'boolean', default: false },
          gain: { type: 'number', minimum: 0.1, maximum: 1.2, default: 0.82 },
          steps: {
            type: 'array',
            minItems: 16,
            maxItems: 16,
            items: { type: 'number', minimum: 0, maximum: 1 },
            description: '16 sixteenth-note steps per 4/4 bar (0 = rest, 0.01..1.0 = velocity).',
          },
          notes: {
            type: 'array',
            minItems: 16,
            maxItems: 16,
            items: { type: ['integer', 'null'], minimum: 24, maximum: 108 },
            description: 'Optional 16-step MIDI note numbers (24..108) for bass, melody, or harmony singers.',
          },
          seed: {
            type: 'string',
            description: 'Kolmogorov visual seed string determining the Clear Cube head shapes and Fae palette.',
          },
          visuals: {
            type: 'object',
            properties: {
              snapBand: { type: 'string', enum: ['bass', 'mid', 'treble'] },
              snapThreshold: { type: 'number', minimum: 0.12, maximum: 0.92 },
              vfxTriggerMode: { type: 'string', enum: ['on-beat', 'single'] },
            },
          },
        },
      },
    },
  },
} as const;

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

/**
 * Strictly validates & sanitizes any incoming BeatDocument (from UI JSON editor or WebMCP model call).
 */
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

  const title =
    typeof obj.title === 'string' && obj.title.trim().length > 0
      ? obj.title.trim().slice(0, 48)
      : 'Drei Stars Hearth';

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

    const label =
      typeof m.label === 'string' && m.label.trim().length > 0
        ? m.label.trim().slice(0, 24)
        : `${INSTRUMENT_ROLE_LABELS[role].split(' ')[0]}-${String(idx + 1).padStart(2, '0')}`;

    const rawGain = Number(m.gain ?? 0.82);
    const gain = Number(Math.max(0.1, Math.min(1.2, Number.isFinite(rawGain) ? rawGain : 0.82)).toFixed(2));
    const muted = Boolean(m.muted);
    const steps = normalizeSteps16(m.steps, getDefaultStepsForRole(role));
    const notes = normalizeNotes16(m.notes, role);
    const seed =
      typeof m.seed === 'string' && m.seed.trim().length > 0
        ? m.seed.trim().slice(0, 48)
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
    // Harmonize singer accent hue with its linked Drei Star
    base.accentHue = DREI_STAR_HUES[spec.role];
  }
  return {
    ...base,
    snapBand: spec.visuals?.snapBand ?? (spec.role === 'kick' || spec.role === 'bass' ? 'bass' : spec.role === 'hat' || spec.role === 'melody' ? 'treble' : 'mid'),
    snapThreshold: spec.visuals?.snapThreshold ?? 0.48,
    vfxTriggerMode: spec.visuals?.vfxTriggerMode ?? 'on-beat',
  };
}

/**
 * Converts a validated BeatDocument into evenly spaced inner-drum (4) & outer-singer (3) CharacterStates.
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
      label: spec.label,
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
  title = 'Drei Stars Hearth'
): BeatDocument {
  const marchers: BeatMarcherSpec[] = [];
  for (const ch of characters) {
    marchers.push({
      id: ch.id,
      label: ch.label,
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

