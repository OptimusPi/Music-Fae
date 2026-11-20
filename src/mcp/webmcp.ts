import {
  BEAT_DOCUMENT_JSON_SCHEMA,
  BeatDocument,
  BeatMarcherSpec,
  HolonomyConfig,
  INSTRUMENT_ROLES,
  InstrumentRole,
  MAX_BPM,
  MIN_BPM,
  ROLE_VARIANTS,
  bpmToAnimFps,
  validateBeatDocument,
} from '../shared/beatSchema';

export interface WebMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

interface NavigatorModelContext {
  registerTool?: (tool: WebMcpToolDefinition) => void;
  unregisterTool?: (name: string) => void;
  provideContext?: (ctx: { tools: WebMcpToolDefinition[] }) => void;
}

export interface WebMcpStatus {
  nativeAvailable: boolean;
  toolNames: string[];
  lastCall: string | null;
}

export type BeatDropTiming = 'now' | 'next-bar' | 'bar-8-fooof';

export interface LiveJamTelemetry {
  barInPhrase: number;
  beatInBar: number;
  barsUntilFooofDrop: number;
  holonomyThetaDeg: number;
  pendingDropTitle: string | null;
}

export interface WebMcpBridgeActions {
  getBeatDocument: () => BeatDocument;
  getLiveTelemetry: () => LiveJamTelemetry;
  setBpm: (bpm: number) => { bpm: number; animFps: number };
  loadBeatDocument: (doc: BeatDocument) => BeatDocument;
  queueBeatDrop: (doc: BeatDocument, timing: BeatDropTiming) => { queued: boolean; timing: BeatDropTiming; title: string };
  setHolonomy: (patch: Partial<HolonomyConfig>) => HolonomyConfig;
  getShareUrl: () => Promise<{ url: string; byteLength: number; compressed: boolean }>;
  upsertMarcher: (spec: Partial<BeatMarcherSpec> & { role: InstrumentRole }) => BeatMarcherSpec;
  removeMarcher: (id: string) => boolean;
  stageMarcher: (id: string | null) => string | null;
  playMidiNotes: (notes: number[], velocity?: number) => string[];
  onToolInvoked?: (toolName: string) => void;
}

declare global {
  interface Window {
    clearCubeWebMCP?: {
      nativeAvailable: boolean;
      schema: typeof BEAT_DOCUMENT_JSON_SCHEMA;
      tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
      callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
  }
}

/**
 * Registers W3C WebMCP (`navigator.modelContext`) tools so any connected AI model
 * can read the constraint-based Beat JSON Schema, adjust BPM (which also drives walking FPS),
 * compose 4-drum + 3-singer beats, and choreograph Kolmogorov visual effects in real time.
 */
export function registerClearCubeWebMcp(actions: WebMcpBridgeActions): {
  status: WebMcpStatus;
  dispose: () => void;
} {
  const nav = navigator as Navigator & { modelContext?: NavigatorModelContext };
  const mc = nav.modelContext;
  const nativeAvailable = Boolean(mc && (typeof mc.registerTool === 'function' || typeof mc.provideContext === 'function'));

  const wrap = (
    name: string,
    fn: (args: Record<string, unknown>) => unknown
  ): ((args: Record<string, unknown>) => Promise<unknown>) => {
    return async (args: Record<string, unknown> = {}) => {
      actions.onToolInvoked?.(name);
      return fn(args ?? {});
    };
  };

  const tools: WebMcpToolDefinition[] = [
    {
      name: 'get_beat_schema',
      description:
        'Returns the formal JSON Schema and variant catalog for Clear Cube Drei Stars BeatDocuments (4 drum roles + 3 singer roles + Kolmogorov visual constraints).',
      inputSchema: { type: 'object', properties: {} },
      execute: wrap('get_beat_schema', () => ({
        schema: BEAT_DOCUMENT_JSON_SCHEMA,
        variantsByRole: ROLE_VARIANTS,
        animationRule: 'animFps = 0.2 * bpm (12 frames/beat = 6 frames per half-beat STEP/step; 24 FPS at 120 BPM)',
      })),
    },
    {
      name: 'get_beat_state',
      description:
        'Returns the current live BeatDocument JSON including BPM, computed walking animation FPS, musical scale, and all active drum and singer marchers.',
      inputSchema: { type: 'object', properties: {} },
      execute: wrap('get_beat_state', () => {
        const beat = actions.getBeatDocument();
        const telemetry = actions.getLiveTelemetry();
        return {
          beat,
          animFps: bpmToAnimFps(beat.bpm),
          stepsPerBar: 8,
          sequencerSteps: 16,
          liveClock: telemetry,
        };
      }),
    },
    {
      name: 'set_bpm',
      description:
        'Sets the global musical tempo (60..180 BPM). Automatically scales both the beat clock and every marcher walking animation frame rate (0.2 * bpm FPS) with half-beat STEP/step footwork.',
      inputSchema: {
        type: 'object',
        required: ['bpm'],
        properties: {
          bpm: { type: 'integer', minimum: MIN_BPM, maximum: MAX_BPM },
        },
      },
      execute: wrap('set_bpm', (args) => {
        const bpm = Number(args.bpm);
        if (!Number.isFinite(bpm)) {
          return { ok: false, error: 'bpm must be a number between 60 and 180.' };
        }
        const res = actions.setBpm(bpm);
        return { ok: true, ...res };
      }),
    },
    {
      name: 'load_beat_json',
      description:
        'Validates and atomically loads a complete BeatDocument JSON (BPM, scale, 4 drum marchers + 3 Drei Star singer marchers + Kolmogorov visual seeds). Ideal for generating a complete beat and visual show.',
      inputSchema: {
        type: 'object',
        required: ['beat'],
        properties: {
          beat: BEAT_DOCUMENT_JSON_SCHEMA,
        },
      },
      execute: wrap('load_beat_json', (args) => {
        const candidate = args.beat ?? args;
        const validation = validateBeatDocument(candidate);
        if (!validation.document) {
          return { ok: false, errors: validation.errors };
        }
        const loaded = actions.loadBeatDocument(validation.document);
        return {
          ok: true,
          warnings: validation.errors,
          beat: loaded,
          animFps: bpmToAnimFps(loaded.bpm),
        };
      }),
    },
    {
      name: 'queue_beat_drop',
      description:
        'Queues a complete BeatDocument to drop cleanly in musical sync — either right after the Bar-8 campfire FOOOF! ("bar-8-fooof") or on the next bar downbeat ("next-bar"). Lights up a live anticipation countdown on the Drei Stars.',
      inputSchema: {
        type: 'object',
        required: ['beat'],
        properties: {
          beat: BEAT_DOCUMENT_JSON_SCHEMA,
          timing: {
            type: 'string',
            enum: ['bar-8-fooof', 'next-bar', 'now'],
            default: 'bar-8-fooof',
          },
        },
      },
      execute: wrap('queue_beat_drop', (args) => {
        const candidate = args.beat ?? args;
        const validation = validateBeatDocument(candidate);
        if (!validation.document) {
          return { ok: false, errors: validation.errors };
        }
        const rawTiming = String(args.timing ?? 'bar-8-fooof');
        const timing: BeatDropTiming =
          rawTiming === 'now' || rawTiming === 'next-bar' || rawTiming === 'bar-8-fooof'
            ? rawTiming
            : 'bar-8-fooof';
        const res = actions.queueBeatDrop(validation.document, timing);
        return { ok: true, ...res, warnings: validation.errors };
      }),
    },
    {
      name: 'set_holonomy',
      description:
        'Composes music geometrically by configuring the campfire Holonomy Sequencer: global manifold curvature K (-1..1), Euclidean rhythm rotation per orbit, diatonic parallel-transport harmony transposition, timbre morphing, and localized curvature wells.',
      inputSchema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          curvature: { type: 'number', minimum: -1, maximum: 1 },
          rhythmRotatePerOrbit: { type: 'boolean' },
          harmonyTransposePerOrbit: { type: 'boolean' },
          timbreMorph: { type: 'number', minimum: 0, maximum: 1 },
          wells: {
            type: 'array',
            maxItems: 4,
            items: {
              type: 'object',
              required: ['angle', 'radius', 'strength'],
              properties: {
                id: { type: 'string' },
                angle: { type: 'number', minimum: 0, maximum: 6.29 },
                radius: { type: 'number', minimum: 5.5, maximum: 10.8 },
                strength: { type: 'number', minimum: -1, maximum: 1 },
              },
            },
          },
        },
      },
      execute: wrap('set_holonomy', (args) => {
        const next = actions.setHolonomy(args as Partial<HolonomyConfig>);
        return { ok: true, holonomy: next };
      }),
    },
    {
      name: 'get_share_url',
      description:
        'Compresses the live BeatDocument (BPM, scale, all marchers, Kolmogorov seeds, and holonomy curvature) into a zero-backend shareable #beat= URL cartridge.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        actions.onToolInvoked?.('get_share_url');
        const res = await actions.getShareUrl();
        return { ok: true, ...res };
      },
    },
    {
      name: 'upsert_marcher',
      description:
        'Adds a new drum or singer marcher, or updates an existing marcher by id, specifying role, sound variant, 16-step rhythm, optional MIDI notes, and Kolmogorov visual seed.',
      inputSchema: {
        type: 'object',
        required: ['role'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          role: { type: 'string', enum: INSTRUMENT_ROLES },
          variant: { type: 'string' },
          muted: { type: 'boolean' },
          gain: { type: 'number', minimum: 0.1, maximum: 1.2 },
          steps: {
            type: 'array',
            minItems: 16,
            maxItems: 16,
            items: { type: 'number', minimum: 0, maximum: 1 },
          },
          notes: {
            type: 'array',
            minItems: 16,
            maxItems: 16,
            items: { type: ['integer', 'null'], minimum: 24, maximum: 108 },
          },
          seed: { type: 'string' },
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
      execute: wrap('upsert_marcher', (args) => {
        const role = String(args.role ?? '') as InstrumentRole;
        if (!INSTRUMENT_ROLES.includes(role)) {
          return { ok: false, error: `Invalid role "${role}". Valid roles: ${INSTRUMENT_ROLES.join(', ')}` };
        }
        const created = actions.upsertMarcher(args as Partial<BeatMarcherSpec> & { role: InstrumentRole });
        return { ok: true, marcher: created };
      }),
    },
    {
      name: 'remove_marcher',
      description: 'Removes an instrument marcher from the clearing by id.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      execute: wrap('remove_marcher', (args) => {
        const removed = actions.removeMarcher(String(args.id ?? ''));
        return { ok: removed, id: String(args.id ?? '') };
      }),
    },
    {
      name: 'stage_marcher',
      description:
        'Walks a marcher to hearthside center stage (expanding its Clear Cube head to 3.35x scale) or passes null to release back into the marching ring.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: ['string', 'null'] },
        },
      },
      execute: wrap('stage_marcher', (args) => {
        const nextId = args.id === null || args.id === undefined ? null : String(args.id);
        const stagedId = actions.stageMarcher(nextId);
        return { ok: true, stagedId };
      }),
    },
    {
      name: 'play_midi_notes',
      description:
        'Plays one or more MIDI notes (24..108) on the live Zyn polyphonic synth and fires synchronized crystal shockwaves.',
      inputSchema: {
        type: 'object',
        required: ['notes'],
        properties: {
          notes: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: { type: 'integer', minimum: 24, maximum: 108 },
          },
          velocity: { type: 'number', minimum: 0.1, maximum: 1.0, default: 0.84 },
        },
      },
      execute: wrap('play_midi_notes', (args) => {
        const notes = Array.isArray(args.notes) ? args.notes.map((n) => Math.round(Number(n))) : [];
        const vel = typeof args.velocity === 'number' ? args.velocity : 0.84;
        const played = actions.playMidiNotes(notes, vel);
        return { ok: true, played };
      }),
    },
  ];

  // Register on native W3C WebMCP (`navigator.modelContext`) when supported by browser/extension
  if (mc) {
    try {
      if (typeof mc.registerTool === 'function') {
        for (const tool of tools) {
          mc.registerTool(tool);
        }
      } else if (typeof mc.provideContext === 'function') {
        mc.provideContext({ tools });
      }
    } catch (err) {
      console.warn('WebMCP tool registration skipped:', err);
    }
  }

  // Always expose clean client bridge on `window.clearCubeWebMCP` for external bridges & devtools
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  window.clearCubeWebMCP = {
    nativeAvailable,
    schema: BEAT_DOCUMENT_JSON_SCHEMA,
    tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    callTool: async (name: string, args?: Record<string, unknown>) => {
      const tool = toolMap.get(name);
      if (!tool) throw new Error(`Unknown WebMCP tool: ${name}`);
      return await tool.execute(args ?? {});
    },
  };

  const toolNames = tools.map((t) => t.name);

  return {
    status: {
      nativeAvailable,
      toolNames,
      lastCall: null,
    },
    dispose: () => {
      if (mc && typeof mc.unregisterTool === 'function') {
        for (const name of toolNames) {
          try {
            mc.unregisterTool(name);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
      if (window.clearCubeWebMCP) {
        delete window.clearCubeWebMCP;
      }
    },
  };
}
