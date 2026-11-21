import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Eraser,
  Link2,
  Mic,
  Minus,
  Plus,
  RotateCcw,
  Shuffle,
  Square,
  Video,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Midi47LayoutId } from '../audio/midi47';
import {
  AudioSourceMode,
  ZynPatchId,
  ZynSynthParams,
  midiToNoteName,
  soundEngine,
} from '../audio/soundEngine';
import { HudSnapshot, RecordStepTarget } from '../scene/PlaygroundScene';
import {
  BEAT_PRESETS,
  BeatDocument,
  INSTRUMENT_ROLES,
  INSTRUMENT_ROLE_LABELS,
  InstrumentRole,
  MUSICAL_SCALE_LABELS,
  MusicalScaleId,
  ROLE_VARIANTS,
  getDefaultVariantForRole,
  isSingerRole,
} from '../shared/beatSchema';
import {
  BRAIN_SHAPE_KINDS,
  BRAIN_SHAPE_LABELS,
  BrainShapeKind,
  CUBE_COLOR_SWATCHES,
  KolmogorovBrain,
  decodeKolmogorov,
  encodeKolmogorov,
  generateRandomKolmogorovBrain,
} from '../shared/protocol';
import { EncodedCartridge } from '../shared/urlCartridge';
import { Keyboard47 } from './Keyboard47';

type DockTab = 'beats' | 'cube' | 'keys';

interface ControlDockProps {
  hud: HudSnapshot;
  onSetBpm: (bpm: number) => void;
  onSetScale: (scale: MusicalScaleId) => void;
  onSpawnMarcher: (role: InstrumentRole, variant: string) => void;
  onStageMarcher: (id: string | null) => void;
  onRemoveMarcher: (id: string) => void;
  onUpdateMarcherInstrument: (
    id: string,
    patch: Partial<{
      role: InstrumentRole;
      variant: string;
      steps: number[];
      notes: Array<number | null> | undefined;
      gain: number;
      muted: boolean;
    }>
  ) => void;
  onSetMarcherStep: (id: string, stepIdx: number, active?: boolean) => void;
  onNudgeMarcherNote: (id: string, stepIdx: number, deltaDegree: number) => void;
  onClearAllSteps: () => void;
  onSetRecordTarget: (target: RecordStepTarget | null) => void;
  onUpdateBrain: (brain: KolmogorovBrain, replayBoot?: boolean) => void;
  onMidiLayoutChange: (layout: Midi47LayoutId) => void;
  onTriggerKey47: (code: string, midi: number) => void;
  onLoadBeatDocument: (doc: BeatDocument) => void;
  onCreateShareUrl: () => Promise<EncodedCartridge | null>;
  onToggleVideoRecording: () => Promise<unknown>;
  onExportMidi: () => string;
}

const SCALE_ORDER: MusicalScaleId[] = [
  'D-lydian',
  'C-pentatonic',
  'F-major',
  'A-minor',
  'E-dorian',
];

const SHORT_PRESET_NAMES: Record<string, string> = {
  'campfire-jam': 'Campfire',
  'night-stroll': 'Night',
  'rainy-moss': 'Moss',
};

const SHORT_PATCH_NAMES: Record<ZynPatchId, string> = {
  'pad-glass': 'Glass',
  'ad-brass': 'Brass',
  'sub-pluck': 'Pluck',
  'fm-bell': 'Bell',
  'lofi-acid': 'Bass',
};

const SHORT_LAYOUT_NAMES: Record<Midi47LayoutId, string> = {
  vmpk: 'Piano',
  isomorphic: 'Grid',
  chromatic: 'Order',
};

const SHORT_VARIANT_LABELS: Record<string, string> = {
  'warm-sub': 'Warm',
  '808-bloom': 'Boom',
  'hearth-thump': 'Soft',
  'wood-rim': 'Rim',
  'brush-snap': 'Brush',
  'tape-crack': 'Snap',
  'crystal-tick': 'Tick',
  'moss-shaker': 'Leaf',
  'open-shimmer': 'Open',
  'kalimba-wood': 'Thumb',
  'ember-tom': 'Tom',
  'chime-conga': 'Conga',
  'zimmer-cello': 'Cello',
  'analog-sub': 'Sub',
  'moss-drone': 'Hum',
  'fae-bell': 'Box',
  'glass-flute': 'Flute',
  'tycho-rhodes': 'Keys',
  'choir-pad': 'Choir',
  'quartz-arp': 'Pluck',
  'warm-brass': 'Horns',
};

const ROLE_CELL_STYLES: Record<
  InstrumentRole,
  { dot: string; activeStep: string; activeText: string }
> = {
  kick: {
    dot: 'bg-orange-400',
    activeStep: 'bg-orange-400 border-orange-300',
    activeText: 'text-slate-950',
  },
  snare: {
    dot: 'bg-emerald-400',
    activeStep: 'bg-emerald-400 border-emerald-300',
    activeText: 'text-slate-950',
  },
  hat: {
    dot: 'bg-lime-400',
    activeStep: 'bg-lime-400 border-lime-300',
    activeText: 'text-slate-950',
  },
  perc: {
    dot: 'bg-amber-300',
    activeStep: 'bg-amber-300 border-amber-200',
    activeText: 'text-slate-950',
  },
  bass: {
    dot: 'bg-amber-500',
    activeStep: 'bg-amber-500 border-amber-300',
    activeText: 'text-slate-950',
  },
  melody: {
    dot: 'bg-teal-400',
    activeStep: 'bg-teal-400 border-teal-200',
    activeText: 'text-slate-950',
  },
  harmony: {
    dot: 'bg-violet-400',
    activeStep: 'bg-violet-400 border-violet-300',
    activeText: 'text-slate-950',
  },
};

const SWATCH_BG_CLASSES: Record<string, string> = {
  gold: 'bg-amber-400',
  coral: 'bg-orange-500',
  berry: 'bg-pink-500',
  violet: 'bg-violet-500',
  sky: 'bg-sky-400',
  aqua: 'bg-teal-400',
  mint: 'bg-emerald-400',
  lime: 'bg-lime-400',
};

function nearestSwatchId(hue: number): string {
  const norm = ((hue % 360) + 360) % 360;
  let best = CUBE_COLOR_SWATCHES[0].id;
  let bestDist = 999;
  for (const sw of CUBE_COLOR_SWATCHES) {
    const raw = Math.abs(sw.hue - norm);
    const dist = Math.min(raw, 360 - raw);
    if (dist < bestDist) {
      bestDist = dist;
      best = sw.id;
    }
  }
  return best;
}

function ShapeGlyph({ kind }: { kind: BrainShapeKind }) {
  switch (kind) {
    case 'tetra':
      return (
        <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7">
          <polygon points="10,3 17,16 3,16" />
        </svg>
      );
    case 'octa':
      return (
        <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7">
          <polygon points="10,2.5 17,10 10,17.5 3,10" />
        </svg>
      );
    case 'icosa':
      return (
        <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7">
          <polygon points="10,2.5 16.5,6.2 16.5,13.8 10,17.5 3.5,13.8 3.5,6.2" />
        </svg>
      );
    case 'torus':
      return (
        <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="10" cy="10" r="6.2" />
          <circle cx="10" cy="10" r="2.3" />
        </svg>
      );
    case 'knot':
      return (
        <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M6,7 C3,7 3,13 6,13 C9,13 11,7 14,7 C17,7 17,13 14,13 C11,13 9,7 6,7 Z" />
        </svg>
      );
    case 'dodeca':
      return (
        <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <polygon points="10,2.2 12.1,7.5 17.8,7.8 13.3,11.3 14.8,16.8 10,13.7 5.2,16.8 6.7,11.3 2.2,7.8 7.9,7.5" />
        </svg>
      );
    case 'cone':
      return (
        <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M10,3 L16,15.5 A6,2 0 0,1 4,15.5 Z" />
        </svg>
      );
    case 'prism':
      return (
        <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="4.5" y="4" width="11" height="12" rx="1.5" />
          <line x1="10" y1="4" x2="10" y2="16" />
        </svg>
      );
  }
}

const BEAT_BLOCKS = [0, 1, 2, 3] as const;
const SUB_STEPS = [0, 1, 2, 3] as const;

export const ControlDock: React.FC<ControlDockProps> = ({
  hud,
  onSetBpm,
  onSetScale,
  onSpawnMarcher,
  onStageMarcher,
  onRemoveMarcher,
  onUpdateMarcherInstrument,
  onSetMarcherStep,
  onNudgeMarcherNote,
  onClearAllSteps,
  onSetRecordTarget,
  onUpdateBrain,
  onMidiLayoutChange,
  onTriggerKey47,
  onLoadBeatDocument,
  onCreateShareUrl,
  onToggleVideoRecording,
  onExportMidi,
}) => {
  const [activeTab, setActiveTab] = useState<DockTab>('beats');
  const [collapsed, setCollapsed] = useState(false);
  const [audioMode, setAudioMode] = useState<AudioSourceMode>(() => soundEngine.getMode());
  const [zynParams, setZynParams] = useState<ZynSynthParams>(() => soundEngine.getZynParams());
  const [recipeInput, setRecipeInput] = useState<string>(hud.stagedBrain.seed);
  const [copiedShare, setCopiedShare] = useState(false);

  // Drag-painting state across rows & columns
  const paintStateRef = useRef<{ active: boolean; paintValue: boolean }>({
    active: false,
    paintValue: true,
  });

  useEffect(() => {
    const stopPaint = () => {
      paintStateRef.current.active = false;
    };
    window.addEventListener('pointerup', stopPaint);
    window.addEventListener('pointercancel', stopPaint);
    return () => {
      window.removeEventListener('pointerup', stopPaint);
      window.removeEventListener('pointercancel', stopPaint);
    };
  }, []);

  useEffect(() => {
    setRecipeInput(hud.stagedBrain.seed);
  }, [hud.stagedBrain.seed]);

  const activeKeySet = new Set(hud.activeKeyCodes);

  const handleModeChange = async (next: AudioSourceMode) => {
    await soundEngine.setMode(next);
    setAudioMode(soundEngine.getMode());
  };

  const handlePatchZyn = (patch: Partial<ZynSynthParams>) => {
    const updated = soundEngine.setZynParams(patch);
    setZynParams(updated);
  };

  const cycleScale = () => {
    const idx = SCALE_ORDER.indexOf(hud.beatScale);
    const next = SCALE_ORDER[(idx + 1) % SCALE_ORDER.length];
    onSetScale(next);
  };

  const cycleRowVariant = (id: string, role: InstrumentRole, currentVariant: string) => {
    const variants = ROLE_VARIANTS[role];
    const idx = variants.findIndex((v) => v.id === currentVariant);
    const next = variants[(idx + 1) % variants.length];
    onUpdateMarcherInstrument(id, { variant: next.id });
  };

  const handleShapeOrColorChange = (
    slotIdx: 0 | 1 | 2,
    patch: { kind?: BrainShapeKind; hue?: number }
  ) => {
    const nextShapes = hud.stagedBrain.shapes.map((sp, i) =>
      i === slotIdx ? { ...sp, ...patch } : { ...sp }
    ) as KolmogorovBrain['shapes'];

    const accentHue =
      slotIdx === 0 && patch.hue !== undefined ? patch.hue : hud.stagedBrain.accentHue;
    const bodyHue =
      slotIdx === 0 && patch.hue !== undefined
        ? (patch.hue + 195) % 360
        : hud.stagedBrain.bodyHue;
    const draft = {
      ...hud.stagedBrain,
      accentHue,
      bodyHue,
      shapes: nextShapes,
    };
    onUpdateBrain({ ...draft, seed: encodeKolmogorov(draft) }, false);
  };

  const handleApplyRecipe = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateBrain(decodeKolmogorov(recipeInput), true);
  };

  const handleShareClick = async () => {
    const res = await onCreateShareUrl();
    if (!res) return;
    try {
      await navigator.clipboard.writeText(res.url);
    } catch {
      // Address bar hash already updated
    }
    setCopiedShare(true);
    window.setTimeout(() => setCopiedShare(false), 1800);
  };

  const currentPresetKey =
    Object.entries(BEAT_PRESETS).find(([, doc]) => doc.title === hud.beatTitle)?.[0] ?? '';

  const cubeRows: Array<{ idx: 0 | 1 | 2; label: string; level: number }> = [
    { idx: 0, label: 'Low', level: hud.audioBands.bass },
    { idx: 1, label: 'Mid', level: hud.audioBands.mid },
    { idx: 2, label: 'High', level: hud.audioBands.treble },
  ];

  return (
    <section
      aria-label="Sequencer and controls"
      className="fixed bottom-3 left-1/2 -translate-x-1/2 z-30 w-[calc(100vw-1rem)] max-w-[920px] rounded-lg bg-[#10131b]/95 border border-white/10 text-slate-100 shadow-2xl select-none"
    >
      {/* Slim 1-Line Header Strip */}
      <div className="flex items-center justify-between gap-2 px-2.5 h-9 border-b border-white/8 overflow-x-auto">
        {/* Left: Presets · BPM · Scale */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center rounded bg-[#181d29] p-0.5">
            {Object.entries(BEAT_PRESETS).map(([key, doc]) => {
              const isCurrent = key === currentPresetKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onLoadBeatDocument(doc)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                    isCurrent
                      ? 'bg-white/14 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {SHORT_PRESET_NAMES[key] ?? doc.title}
                </button>
              );
            })}
          </div>

          <div
            className="flex items-center rounded bg-[#181d29] px-1 h-6 text-[11px] font-mono tabular-nums"
            onWheel={(e) => {
              e.preventDefault();
              onSetBpm(hud.musicalClock.bpm + (e.deltaY < 0 ? 2 : -2));
            }}
            title="Click -/+ or scroll to adjust tempo"
          >
            <button
              type="button"
              aria-label="Slower"
              onClick={() => onSetBpm(hud.musicalClock.bpm - 4)}
              className="p-0.5 text-slate-400 hover:text-white cursor-pointer"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="px-1.5 text-amber-300 whitespace-nowrap">
              {hud.musicalClock.bpm}
            </span>
            <button
              type="button"
              aria-label="Faster"
              onClick={() => onSetBpm(hud.musicalClock.bpm + 4)}
              className="p-0.5 text-slate-400 hover:text-white cursor-pointer"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={cycleScale}
            className="h-6 px-2 rounded bg-[#181d29] hover:bg-[#22293a] text-[11px] text-slate-300 hover:text-white whitespace-nowrap cursor-pointer"
            title="Click to cycle musical scale"
          >
            {MUSICAL_SCALE_LABELS[hud.beatScale]}
          </button>
        </div>

        {/* Center: Mode Switch + Back to Circle */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center rounded bg-[#0a0c12] p-0.5 border border-white/8">
            {(
              [
                { id: 'beats', label: 'Beats' },
                { id: 'cube', label: 'Cube' },
                { id: 'keys', label: 'Keys' },
              ] as const
            ).map((tab) => {
              const active = !collapsed && activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setCollapsed(false);
                  }}
                  className={`px-2.5 py-0.5 rounded text-xs font-medium whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-amber-400 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {hud.stagedId && (
            <button
              type="button"
              onClick={() => onStageMarcher(null)}
              className="flex items-center gap-1 h-6 px-2 rounded bg-amber-400/15 hover:bg-amber-400/25 text-amber-200 text-[11px] font-medium whitespace-nowrap cursor-pointer"
              title="Send character back to campfire circle"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Circle</span>
            </button>
          )}
        </div>

        {/* Right: Audio · Clear · MIDI · Share · Collapse */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            aria-label={audioMode === 'muted' ? 'Unmute' : 'Mute'}
            onClick={() => void handleModeChange(audioMode === 'muted' ? 'synth' : 'muted')}
            className={`flex items-center justify-center w-6 h-6 rounded bg-[#181d29] hover:bg-[#22293a] cursor-pointer ${
              audioMode === 'muted' ? 'text-rose-400' : 'text-emerald-300'
            }`}
            title={audioMode === 'muted' ? 'Unmute audio' : 'Mute audio'}
          >
            {audioMode === 'muted' ? (
              <VolumeX className="w-3.5 h-3.5" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            aria-label="Microphone beat sync"
            onClick={() => void handleModeChange(audioMode === 'mic' ? 'synth' : 'mic')}
            className={`flex items-center justify-center w-6 h-6 rounded cursor-pointer ${
              audioMode === 'mic'
                ? 'bg-sky-500/25 text-sky-300'
                : 'bg-[#181d29] hover:bg-[#22293a] text-slate-400 hover:text-slate-200'
            }`}
            title="Sync campfire to microphone"
          >
            <Mic className="w-3.5 h-3.5" />
          </button>

          {!collapsed && activeTab === 'beats' && (
            <button
              type="button"
              aria-label="Clear all steps"
              onClick={onClearAllSteps}
              className="flex items-center justify-center w-6 h-6 rounded bg-[#181d29] hover:bg-[#22293a] text-slate-400 hover:text-white cursor-pointer"
              title="Clear all steps"
            >
              <Eraser className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            aria-label="Export MIDI"
            onClick={() => onExportMidi()}
            className="flex items-center justify-center w-6 h-6 rounded bg-[#181d29] hover:bg-[#22293a] text-slate-400 hover:text-white cursor-pointer"
            title="Download MIDI file"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            aria-label="Copy share link"
            onClick={() => void handleShareClick()}
            className="flex items-center justify-center w-6 h-6 rounded bg-[#181d29] hover:bg-[#22293a] text-slate-400 hover:text-white cursor-pointer"
            title="Copy shareable link"
          >
            {copiedShare ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Link2 className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            aria-label={collapsed ? 'Show panel' : 'Hide panel'}
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center justify-center w-6 h-6 rounded bg-[#181d29] hover:bg-[#22293a] text-slate-300 cursor-pointer"
          >
            {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Active Workspace */}
      {!collapsed && (
        <div className="px-2.5 py-2">
          {/* VIEW 1: MULTI-ROW STEP SEQUENCER */}
          {activeTab === 'beats' && (
            <div className="space-y-1">
              {/* 4-Beat Column Ruler */}
              <div className="flex items-center gap-2 pl-[136px] pr-5">
                <div className="flex-1 grid grid-cols-4 gap-2">
                  {BEAT_BLOCKS.map((b) => (
                    <div key={b} className="grid grid-cols-4 gap-1">
                      {SUB_STEPS.map((s) => {
                        const stepIdx = b * 4 + s;
                        const isPlayhead = hud.musicalClock.step16 === stepIdx;
                        return (
                          <div
                            key={stepIdx}
                            className={`h-2 flex items-center justify-center font-mono text-[9px] leading-none tabular-nums ${
                              isPlayhead
                                ? 'text-amber-300 font-bold'
                                : s === 0
                                  ? 'text-slate-500'
                                  : 'text-slate-700'
                            }`}
                          >
                            {s === 0 ? b + 1 : '·'}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {/* Stacked Instrument Rows */}
              <div className="space-y-1 max-h-[228px] overflow-y-auto pr-0.5">
                {hud.marchers.map((row) => {
                  const style = ROLE_CELL_STYLES[row.role];
                  const isStaged = hud.stagedId === row.id;
                  const singer = isSingerRole(row.role);
                  const shortTone = SHORT_VARIANT_LABELS[row.variant] ?? row.variant;

                  return (
                    <div
                      key={row.id}
                      className="flex items-center gap-2 h-6 group"
                    >
                      {/* Row Header: Mute + Character Focus + Tone Cycle */}
                      <div className="w-[128px] shrink-0 flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-label={row.muted ? `Unmute ${row.label}` : `Mute ${row.label}`}
                          onClick={() =>
                            onUpdateMarcherInstrument(row.id, { muted: !row.muted })
                          }
                          className={`w-3.5 h-3.5 rounded-[3px] shrink-0 transition-opacity cursor-pointer ${
                            row.muted
                              ? 'border border-white/25 bg-transparent opacity-40'
                              : style.dot
                          }`}
                          title={row.muted ? 'Unmute row' : 'Mute row'}
                        />

                        <button
                          type="button"
                          onClick={() => onStageMarcher(isStaged ? null : row.id)}
                          className={`text-xs truncate text-left flex-1 cursor-pointer ${
                            row.muted
                              ? 'text-slate-500 line-through'
                              : isStaged
                                ? 'text-amber-300 font-semibold'
                                : 'text-slate-200 hover:text-white font-medium'
                          }`}
                          title={isStaged ? 'Back to circle' : 'Bring up to campfire'}
                        >
                          {row.label}
                        </button>

                        <button
                          type="button"
                          onClick={() => cycleRowVariant(row.id, row.role, row.variant)}
                          className="font-mono text-[10px] text-slate-400 hover:text-slate-100 shrink-0 cursor-pointer"
                          title="Click to cycle sound"
                        >
                          {shortTone}
                        </button>
                      </div>

                      {/* 16 Tactile Steps grouped in 4 Beat Blocks of 4 */}
                      <div className="flex-1 grid grid-cols-4 gap-2">
                        {BEAT_BLOCKS.map((b) => (
                          <div key={b} className="grid grid-cols-4 gap-1">
                            {SUB_STEPS.map((s) => {
                              const stepIdx = b * 4 + s;
                              const isOn = (row.steps[stepIdx] ?? 0) > 0.05;
                              const isPlayhead = hud.musicalClock.step16 === stepIdx;
                              const isArmed =
                                hud.recordTarget?.id === row.id &&
                                hud.recordTarget?.stepIdx === stepIdx;
                              const noteMidi = singer ? row.notes?.[stepIdx] : null;

                              return (
                                <button
                                  key={stepIdx}
                                  type="button"
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    if (singer) {
                                      onNudgeMarcherNote(row.id, stepIdx, 1);
                                    }
                                  }}
                                  onWheel={(e) => {
                                    if (singer) {
                                      e.preventDefault();
                                      onNudgeMarcherNote(
                                        row.id,
                                        stepIdx,
                                        e.deltaY < 0 ? 1 : -1
                                      );
                                    }
                                  }}
                                  onDoubleClick={() => {
                                    if (singer) {
                                      onSetRecordTarget(
                                        isArmed ? null : { id: row.id, stepIdx }
                                      );
                                    }
                                  }}
                                  onPointerDown={(e) => {
                                    if (e.button !== 0) return;
                                    e.preventDefault();
                                    if (e.shiftKey && singer) {
                                      onSetRecordTarget(
                                        isArmed ? null : { id: row.id, stepIdx }
                                      );
                                      return;
                                    }
                                    const nextVal = !isOn;
                                    paintStateRef.current = {
                                      active: true,
                                      paintValue: nextVal,
                                    };
                                    onSetMarcherStep(row.id, stepIdx, nextVal);
                                  }}
                                  onPointerEnter={() => {
                                    if (paintStateRef.current.active) {
                                      onSetMarcherStep(
                                        row.id,
                                        stepIdx,
                                        paintStateRef.current.paintValue
                                      );
                                    }
                                  }}
                                  className={`h-6 rounded-[4px] border flex items-center justify-center transition-colors cursor-pointer ${
                                    isArmed
                                      ? 'bg-white text-slate-950 border-white font-bold'
                                      : isOn
                                        ? `${style.activeStep} ${style.activeText} ${
                                            row.muted ? 'opacity-35' : ''
                                          } ${isPlayhead ? 'ring-1 ring-white brightness-115' : ''}`
                                        : isPlayhead
                                          ? 'bg-white/18 border-white/35 text-white'
                                          : s === 0
                                            ? 'bg-[#1b202e] border-white/10 hover:border-white/25'
                                            : 'bg-[#141823] border-white/6 hover:border-white/20'
                                  }`}
                                >
                                  {singer && isOn && typeof noteMidi === 'number' && (
                                    <span className="font-mono text-[9px] font-semibold leading-none tracking-tighter">
                                      {midiToNoteName(noteMidi)}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>

                      {/* Remove Row */}
                      <div className="w-3.5 shrink-0 flex items-center justify-center">
                        {hud.marchers.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Remove ${row.label}`}
                            onClick={() => onRemoveMarcher(row.id)}
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-500 hover:text-rose-400 cursor-pointer"
                            title="Remove row"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Quiet Single-Line Add-Row Footer */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/6 text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5 text-slate-400">
                  <span className="text-slate-500">+</span>
                  {INSTRUMENT_ROLES.map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => onSpawnMarcher(role, getDefaultVariantForRole(role))}
                      className="px-1.5 py-0.5 rounded hover:bg-white/8 hover:text-slate-100 whitespace-nowrap cursor-pointer"
                    >
                      {INSTRUMENT_ROLE_LABELS[role]}
                    </button>
                  ))}
                </div>

                {hud.recordTarget ? (
                  <button
                    type="button"
                    onClick={() => onSetRecordTarget(null)}
                    className="text-teal-300 hover:text-white font-mono text-[10px] cursor-pointer"
                  >
                    Step input active · click to stop
                  </button>
                ) : (
                  <span className="hidden sm:inline text-[10px] text-slate-500">
                    Drag to paint · scroll melody steps for pitch
                  </span>
                )}
              </div>
            </div>
          )}

          {/* VIEW 2: VISUAL 3-ROW CUBE HEAD BUILDER (ZERO DROPDOWNS) */}
          {activeTab === 'cube' && (
            <div className="space-y-2">
              {/* Inline Character Selector Strip */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-white/6">
                <div className="flex flex-wrap items-center gap-1">
                  {hud.marchers.map((m) => {
                    const selected =
                      (hud.stagedCharacter?.id ?? hud.marchers[0]?.id) === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => onStageMarcher(m.id)}
                        className={`px-2 py-0.5 rounded text-xs whitespace-nowrap cursor-pointer ${
                          selected
                            ? 'bg-white/15 text-white font-semibold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-1">
                  {(
                    [
                      { label: 'Smooth', val: 0.1 },
                      { label: 'Crisp', val: 0.55 },
                      { label: 'PSX', val: 0.92 },
                    ] as const
                  ).map((snap) => {
                    const active = Math.abs(hud.stagedBrain.jankLevel - snap.val) < 0.23;
                    return (
                      <button
                        key={snap.label}
                        type="button"
                        onClick={() =>
                          onUpdateBrain({ ...hud.stagedBrain, jankLevel: snap.val }, false)
                        }
                        className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                          active
                            ? 'bg-white/15 text-white font-medium'
                            : 'text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {snap.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3 Visual Shape + Color Rows (Low, Mid, High) */}
              <div className="space-y-1.5">
                {cubeRows.map(({ idx, label, level }) => {
                  const sp = hud.stagedBrain.shapes[idx];
                  const activeColorId = nearestSwatchId(sp.hue);
                  const meterWidth = Math.max(8, Math.min(100, Math.round(level * 100)));

                  return (
                    <div
                      key={idx}
                      className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 min-h-7"
                    >
                      {/* Band Name + Live Meter */}
                      <div className="w-24 shrink-0 flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-300 w-9">{label}</span>
                        <svg className="w-11 h-1.5 rounded-full bg-white/8 overflow-hidden" aria-hidden="true">
                          <rect
                            x={0}
                            y={0}
                            width={`${meterWidth}%`}
                            height="100%"
                            rx={3}
                            fill="#fbbf24"
                          />
                        </svg>
                      </div>

                      {/* 8 Visual Shape Silhouette Buttons */}
                      <div className="flex items-center gap-1">
                        {BRAIN_SHAPE_KINDS.map((kind) => {
                          const isSelected = sp.kind === kind;
                          return (
                            <button
                              key={kind}
                              type="button"
                              aria-label={`${label} ${BRAIN_SHAPE_LABELS[kind]}`}
                              title={BRAIN_SHAPE_LABELS[kind]}
                              onClick={() => handleShapeOrColorChange(idx, { kind })}
                              className={`w-7 h-7 rounded flex items-center justify-center border transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-amber-400 text-slate-950 border-amber-300'
                                  : 'bg-[#171c28] text-slate-400 border-white/8 hover:text-white hover:border-white/25'
                              }`}
                            >
                              <ShapeGlyph kind={kind} />
                            </button>
                          );
                        })}
                      </div>

                      {/* 8 Color Swatches */}
                      <div className="flex items-center gap-1.5">
                        {CUBE_COLOR_SWATCHES.map((sw) => {
                          const isSelected = sw.id === activeColorId;
                          return (
                            <button
                              key={sw.id}
                              type="button"
                              aria-label={`${label} ${sw.label}`}
                              title={sw.label}
                              onClick={() => handleShapeOrColorChange(idx, { hue: sw.hue })}
                              className={`w-4 h-4 rounded-sm transition-transform cursor-pointer ${
                                SWATCH_BG_CLASSES[sw.id]
                              } ${
                                isSelected
                                  ? 'ring-2 ring-white scale-110'
                                  : 'opacity-65 hover:opacity-100'
                              }`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Slim Lowercase Recipe Input + Surprise */}
              <form
                onSubmit={handleApplyRecipe}
                className="flex items-center gap-1.5 pt-1 border-t border-white/6"
              >
                <input
                  type="text"
                  aria-label="Cube recipe"
                  value={recipeInput}
                  onChange={(e) => setRecipeInput(e.target.value.toLowerCase())}
                  placeholder="sunny-moss or gold.pyramid-aqua.ring-violet.star"
                  className="flex-1 h-7 rounded bg-[#171c28] border border-white/10 px-2.5 font-mono text-xs text-amber-200 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  className="h-7 px-2.5 rounded bg-white/12 hover:bg-white/20 text-xs text-white font-medium cursor-pointer"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateBrain(generateRandomKolmogorovBrain(), true)}
                  className="flex items-center gap-1 h-7 px-2.5 rounded bg-[#171c28] hover:bg-[#22293a] border border-white/10 text-xs text-slate-200 cursor-pointer"
                  title="Randomize 3 shapes"
                >
                  <Shuffle className="w-3.5 h-3.5 text-amber-300" />
                  <span>Random</span>
                </button>
              </form>
            </div>
          )}

          {/* VIEW 3: 47-KEY LIVE SYNTH */}
          {activeTab === 'keys' && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* 5 Synth Voices */}
                <div className="flex items-center gap-1">
                  {(Object.keys(SHORT_PATCH_NAMES) as ZynPatchId[]).map((patchId) => {
                    const active = zynParams.patch === patchId;
                    return (
                      <button
                        key={patchId}
                        type="button"
                        onClick={() => handlePatchZyn({ patch: patchId })}
                        className={`h-6 px-2.5 rounded text-xs whitespace-nowrap cursor-pointer ${
                          active
                            ? 'bg-amber-400 text-slate-950 font-semibold'
                            : 'bg-[#171c28] text-slate-300 hover:text-white'
                        }`}
                      >
                        {SHORT_PATCH_NAMES[patchId]}
                      </button>
                    );
                  })}
                </div>

                {/* Octave · Key Layout · Video Capture */}
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center rounded bg-[#171c28] p-0.5">
                    {([-1, 0, 1] as const).map((oct) => (
                      <button
                        key={oct}
                        type="button"
                        onClick={() => handlePatchZyn({ octave: oct })}
                        className={`px-2 py-0.5 rounded font-mono text-[11px] cursor-pointer ${
                          zynParams.octave === oct
                            ? 'bg-white/15 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {oct > 0 ? `+${oct}` : oct}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center rounded bg-[#171c28] p-0.5">
                    {(Object.keys(SHORT_LAYOUT_NAMES) as Midi47LayoutId[]).map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onMidiLayoutChange(id)}
                        className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                          hud.midiLayout === id
                            ? 'bg-white/15 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {SHORT_LAYOUT_NAMES[id]}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => void onToggleVideoRecording()}
                    className={`flex items-center gap-1 h-6 px-2 rounded text-[11px] cursor-pointer ${
                      hud.recorder.isRecording
                        ? 'bg-rose-500/25 text-rose-200'
                        : 'bg-[#171c28] hover:bg-[#22293a] text-slate-300'
                    }`}
                  >
                    {hud.recorder.isRecording ? (
                      <>
                        <Square className="w-3 h-3 fill-current" />
                        <span>Stop</span>
                      </>
                    ) : (
                      <>
                        <Video className="w-3.5 h-3.5" />
                        <span>Rec</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <Keyboard47
                layout={hud.midiLayout}
                octaveShift={zynParams.octave}
                activeCodes={activeKeySet}
                onTriggerKey={onTriggerKey47}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
};
