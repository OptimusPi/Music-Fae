import React, { useEffect, useMemo, useState } from 'react';
import {
  Cable,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Link2,
  Mic,
  Minus,
  Plus,
  RotateCcw,
  Shuffle,
  Sparkles,
  Square,
  Trash2,
  Video,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { MIDI47_LAYOUT_LABELS, Midi47LayoutId } from '../audio/midi47';
import {
  AudioSourceMode,
  ZYN_PATCH_LABELS,
  ZynPatchId,
  ZynSynthParams,
  midiToNoteName,
  soundEngine,
} from '../audio/soundEngine';
import { BeatDropTiming } from '../mcp/webmcp';
import { HudSnapshot } from '../scene/PlaygroundScene';
import {
  BEAT_DOCUMENT_JSON_SCHEMA,
  BEAT_PRESETS,
  BeatDocument,
  HolonomyConfig,
  INSTRUMENT_ROLES,
  INSTRUMENT_ROLE_LABELS,
  InstrumentRole,
  MAX_BPM,
  MIN_BPM,
  MUSICAL_SCALE_LABELS,
  MusicalScaleId,
  ROLE_VARIANTS,
  getDefaultVariantForRole,
  isSingerRole,
  validateBeatDocument,
} from '../shared/beatSchema';
import {
  BRAIN_SHAPE_KINDS,
  BRAIN_SHAPE_LABELS,
  BrainShapeKind,
  KolmogorovBrain,
  SnapBand,
  VfxTriggerMode,
  decodeKolmogorov,
  encodeKolmogorov,
  generateRandomKolmogorovBrain,
} from '../shared/protocol';
import { EncodedCartridge } from '../shared/urlCartridge';
import { Keyboard47 } from './Keyboard47';

type DockTab = 'ensemble' | 'holonomy' | 'synth' | 'kolmogorov' | 'json';

interface ControlDockProps {
  hud: HudSnapshot;
  onSetBpm: (bpm: number) => void;
  onSetScale: (scale: MusicalScaleId) => void;
  onSpawnMarcher: (role: InstrumentRole, variant: string) => void;
  onStageMarcher: (id: string | null) => void;
  onStageNext: () => void;
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
  onToggleStep: (stepIdx: number) => void;
  onSetRecordStep: (stepIdx: number | null) => void;
  onUpdateBrain: (brain: KolmogorovBrain, replayBoot?: boolean) => void;
  onTriggerBoot: () => void;
  onClearRing: () => void;
  onCameraPreset: (preset: 'stage' | 'overview') => void;
  onMidiLayoutChange: (layout: Midi47LayoutId) => void;
  onTriggerKey47: (code: string, midi: number) => void;
  onGetBeatDocument: () => BeatDocument;
  onLoadBeatDocument: (doc: BeatDocument) => void;
  onQueueBeatDrop: (doc: BeatDocument, timing: BeatDropTiming) => void;
  onFlushPendingDrop: () => void;
  onCancelPendingDrop: () => void;
  onSetHolonomy: (patch: Partial<HolonomyConfig>) => void;
  onAddCurvatureWell: (strength: number) => void;
  onRemoveCurvatureWell: (id: string) => void;
  onResetHolonomyPhase: () => void;
  onCreateShareUrl: () => Promise<EncodedCartridge | null>;
  onReconnectWebMidi: () => Promise<unknown>;
  onSetMidiOutputPort: (portId: string | null) => void;
  onSetMidiOutEnabled: (enabled: boolean) => void;
  onToggleVideoRecording: () => Promise<unknown>;
  onExportMidi: () => string;
}

function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;
}

function formatRecClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const ControlDock: React.FC<ControlDockProps> = ({
  hud,
  onSetBpm,
  onSetScale,
  onSpawnMarcher,
  onStageMarcher,
  onStageNext,
  onRemoveMarcher,
  onUpdateMarcherInstrument,
  onToggleStep,
  onSetRecordStep,
  onUpdateBrain,
  onTriggerBoot,
  onClearRing,
  onCameraPreset,
  onMidiLayoutChange,
  onTriggerKey47,
  onGetBeatDocument,
  onLoadBeatDocument,
  onQueueBeatDrop,
  onFlushPendingDrop,
  onCancelPendingDrop,
  onSetHolonomy,
  onAddCurvatureWell,
  onRemoveCurvatureWell,
  onResetHolonomyPhase,
  onCreateShareUrl,
  onReconnectWebMidi,
  onSetMidiOutputPort,
  onSetMidiOutEnabled,
  onToggleVideoRecording,
  onExportMidi,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<DockTab>('ensemble');
  const [seedInput, setSeedInput] = useState(hud.stagedBrain.seed);
  const [audioMode, setAudioMode] = useState<AudioSourceMode>(soundEngine.getMode());
  const [volume, setVolume] = useState(soundEngine.getVolume());
  const [zynParams, setZynParams] = useState<ZynSynthParams>(soundEngine.getZynParams());

  // Add Marcher picker state (Role + Variant)
  const [spawnRole, setSpawnRole] = useState<InstrumentRole>('melody');
  const [spawnVariant, setSpawnVariant] = useState<string>(getDefaultVariantForRole('melody'));

  // Beat JSON / Studio / WebMCP editor state
  const [jsonDraft, setJsonDraft] = useState<string>('');
  const [jsonStatus, setJsonStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [copiedSchema, setCopiedSchema] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [dropTiming, setDropTiming] = useState<BeatDropTiming>('bar-8-fooof');

  const activeCodesSet = useMemo(() => new Set(hud.activeKeyCodes), [hud.activeKeyCodes]);

  useEffect(() => {
    setSeedInput(hud.stagedBrain.seed);
  }, [hud.stagedBrain.seed]);

  useEffect(() => {
    if (activeTab === 'json') {
      setJsonDraft(JSON.stringify(onGetBeatDocument(), null, 2));
      setJsonStatus(null);
    }
  }, [activeTab, hud.dancerCount, hud.musicalClock.bpm, hud.beatScale, hud.holonomy.curvature, hud.holonomy.wells.length]);

  const handleSpawnRoleChange = (nextRole: InstrumentRole) => {
    setSpawnRole(nextRole);
    setSpawnVariant(getDefaultVariantForRole(nextRole));
  };

  const handleAudioMode = async (next: AudioSourceMode) => {
    setAudioMode(next);
    await soundEngine.setMode(next);
    setAudioMode(soundEngine.getMode());
  };

  const handleVolumeChange = (v: number) => {
    setVolume(v);
    soundEngine.setVolume(v);
  };

  const updateZyn = (patch: Partial<ZynSynthParams>) => {
    setZynParams(soundEngine.setZynParams(patch));
  };

  const applySeedString = (raw: string) => {
    const cur = hud.stagedBrain;
    const decoded = decodeKolmogorov(raw);
    onUpdateBrain(
      {
        ...decoded,
        vfxTriggerMode: cur.vfxTriggerMode,
        snapBand: cur.snapBand,
        snapThreshold: cur.snapThreshold,
      },
      true
    );
  };

  const mutateBrain = () => {
    const cur = hud.stagedBrain;
    const fresh = generateRandomKolmogorovBrain();
    onUpdateBrain(
      {
        ...fresh,
        vfxTriggerMode: cur.vfxTriggerMode,
        snapBand: cur.snapBand,
        snapThreshold: cur.snapThreshold,
      },
      true
    );
  };

  const updateShapeField = (
    idx: 0 | 1 | 2,
    patch: Partial<{ kind: BrainShapeKind; hue: number; scale: number }>
  ) => {
    const cur = hud.stagedBrain;
    const nextShapes = cur.shapes.map((s, i) => (i === idx ? { ...s, ...patch } : s)) as KolmogorovBrain['shapes'];
    const base = {
      complexity: cur.complexity,
      jankLevel: cur.jankLevel,
      bodyHue: cur.bodyHue,
      accentHue: cur.accentHue,
      shapes: nextShapes,
      vfxTriggerMode: cur.vfxTriggerMode,
      snapBand: cur.snapBand,
      snapThreshold: cur.snapThreshold,
    };
    onUpdateBrain({ ...base, seed: encodeKolmogorov(base) }, false);
  };

  const updateBrainMeta = (
    patch: Partial<{
      complexity: number;
      jankLevel: number;
      vfxTriggerMode: VfxTriggerMode;
      snapBand: SnapBand;
      snapThreshold: number;
    }>
  ) => {
    const cur = hud.stagedBrain;
    const nextComp = patch.complexity ?? cur.complexity;
    const nextJank = patch.jankLevel ?? cur.jankLevel;
    const nextShapes = cur.shapes.map((s, i) => ({
      ...s,
      orbitSpeed: Number((0.75 + i * 0.42 + nextComp * 1.1).toFixed(2)),
      reactivity: Number((0.75 + nextComp * 0.85 + i * 0.12).toFixed(2)),
    })) as KolmogorovBrain['shapes'];
    const base = {
      complexity: nextComp,
      jankLevel: nextJank,
      bodyHue: cur.bodyHue,
      accentHue: cur.accentHue,
      shapes: nextShapes,
      vfxTriggerMode: patch.vfxTriggerMode ?? cur.vfxTriggerMode ?? 'on-beat',
      snapBand: patch.snapBand ?? cur.snapBand ?? 'bass',
      snapThreshold: patch.snapThreshold ?? cur.snapThreshold ?? 0.48,
    };
    onUpdateBrain({ ...base, seed: encodeKolmogorov(base) }, false);
  };

  const handleApplyBeatJson = (mode: BeatDropTiming = 'now') => {
    try {
      const parsed = JSON.parse(jsonDraft);
      const res = validateBeatDocument(parsed);
      if (!res.document) {
        setJsonStatus({ kind: 'err', text: res.errors.join(' ') });
        return;
      }
      if (mode === 'now') {
        onLoadBeatDocument(res.document);
        setJsonDraft(JSON.stringify(res.document, null, 2));
        setJsonStatus({
          kind: 'ok',
          text: `Loaded "${res.document.title}" (${res.document.bpm} bpm, ${res.document.marchers.length} marchers)`,
        });
      } else {
        onQueueBeatDrop(res.document, mode);
        setJsonStatus({
          kind: 'ok',
          text: `Queued "${res.document.title}" for ${mode === 'bar-8-fooof' ? 'Bar-8 FOOOF!' : 'next bar'}`,
        });
      }
    } catch (err) {
      setJsonStatus({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Invalid JSON syntax.',
      });
    }
  };

  const handleShareCartridge = async () => {
    const encoded = await onCreateShareUrl();
    if (!encoded) return;
    navigator.clipboard?.writeText(encoded.url);
    const label = `${encoded.byteLength}B link copied`;
    setShareNote(label);
    setJsonStatus({ kind: 'ok', text: `Share cartridge updated (${encoded.byteLength} bytes in #beat= URL)` });
    window.setTimeout(() => setShareNote(null), 2400);
  };

  const handleExportMidi = () => {
    const filename = onExportMidi();
    if (filename) {
      setJsonStatus({ kind: 'ok', text: `Exported 8-bar multi-track MIDI: ${filename}` });
    }
  };

  const handleCopySchema = () => {
    navigator.clipboard?.writeText(JSON.stringify(BEAT_DOCUMENT_JSON_SCHEMA, null, 2));
    setCopiedSchema(true);
    window.setTimeout(() => setCopiedSchema(false), 1800);
  };

  const handleCopyLiveJson = () => {
    const raw = JSON.stringify(onGetBeatDocument(), null, 2);
    setJsonDraft(raw);
    navigator.clipboard?.writeText(raw);
    setCopiedJson(true);
    window.setTimeout(() => setCopiedJson(false), 1800);
  };

  const bandValues = [hud.audioBands.bass, hud.audioBands.mid, hud.audioBands.treble];
  const currentTriggerMode: VfxTriggerMode = hud.stagedBrain.vfxTriggerMode ?? 'on-beat';
  const currentSnapBand: SnapBand = hud.stagedBrain.snapBand ?? 'bass';
  const currentThreshold = hud.stagedBrain.snapThreshold ?? 0.48;
  const activeSnapEnergy =
    currentSnapBand === 'bass'
      ? hud.audioBands.bass
      : currentSnapBand === 'mid'
        ? hud.audioBands.mid
        : hud.audioBands.treble;

  const activeChar = hud.stagedCharacter;
  const clock = hud.musicalClock;

  return (
    <div
      className="fixed bottom-3 left-1/2 -translate-x-1/2 z-20 w-[min(980px,96vw)] pointer-events-none transition-transform duration-200 ease-out"
      style={{ transform: collapsed ? 'translate(-50%, calc(100% - 34px))' : 'translate(-50%, 0)' }}
    >
      {/* Collapse Toggle */}
      <div className="flex justify-center mb-1 pointer-events-auto">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand console' : 'Collapse console'}
          className="flex items-center gap-1.5 px-3 py-1 rounded-t-lg rounded-b-md bg-[#141822]/94 text-slate-300 hover:text-white text-xs font-medium border border-white/10 shadow-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{collapsed ? 'Studio Console' : 'Hide'}</span>
        </button>
      </div>

      {/* Unified Studio Instrument Console — solid obsidian surface, zero backdrop-filter over WebGL */}
      <div className="pointer-events-auto rounded-xl bg-[#141822]/96 text-slate-100 border border-white/12 shadow-2xl overflow-hidden">
        {/* Top Action, Manual BPM & Tab Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b border-white/10">
          {/* Left: Manual BPM (drives tempo + walking step FPS) & Stage Control */}
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/[0.06] border border-white/10"
              title={`BPM controls music tempo and walking animation rate (${clock.animFps.toFixed(1)} fps = 0.2 × bpm)`}
            >
              <button
                type="button"
                aria-label="Decrease BPM"
                onClick={() => onSetBpm(clock.bpm - 2)}
                className="p-0.5 rounded text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="font-mono text-xs font-semibold text-amber-200 tabular-nums w-14 text-center whitespace-nowrap">
                {clock.bpm} bpm
              </span>
              <input
                type="range"
                aria-label="Tempo BPM"
                min={MIN_BPM}
                max={MAX_BPM}
                step={1}
                value={clock.bpm}
                onChange={(e) => onSetBpm(Number(e.target.value))}
                className="cube-slider w-16 sm:w-20"
              />
              <button
                type="button"
                aria-label="Increase BPM"
                onClick={() => onSetBpm(clock.bpm + 2)}
                className="p-0.5 rounded text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3" />
              </button>
              <span className="hidden md:inline font-mono text-[11px] text-slate-400 tabular-nums pl-1 border-l border-white/10 whitespace-nowrap">
                {clock.animFps.toFixed(1)} fps
              </span>
            </div>

            {hud.stagedId ? (
              <button
                type="button"
                onClick={() => onStageMarcher(null)}
                className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/18 text-slate-100 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title="Send staged marcher back to the ring (Esc)"
              >
                Release to Ring
              </button>
            ) : (
              <button
                type="button"
                onClick={onStageNext}
                className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/18 text-slate-100 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Stage Head
              </button>
            )}

            <button
              type="button"
              onClick={onTriggerBoot}
              className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/8 hover:bg-white/14 text-slate-100 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title="Replay 1-2-3 console boot chime"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#ff7a4d]" />
              <span>1·2·3 Boot</span>
            </button>

            <button
              type="button"
              onClick={() => void onToggleVideoRecording()}
              className={`hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                hud.recorder.isRecording
                  ? 'bg-[#ff5a26] hover:bg-[#e84b1a] text-white'
                  : 'bg-white/8 hover:bg-white/14 text-slate-200'
              }`}
              title={
                hud.recorder.isRecording
                  ? 'Stop recording and download 60fps video'
                  : 'Record 60fps WebGL + master audio video'
              }
            >
              {hud.recorder.isRecording ? (
                <>
                  <Square className="w-3 h-3 fill-current" />
                  <span>Stop {formatRecClock(hud.recorder.elapsedSec)}</span>
                </>
              ) : (
                <>
                  <Video className="w-3.5 h-3.5 text-slate-300" />
                  <span>Rec</span>
                </>
              )}
            </button>
          </div>

          {/* Right: Section Switcher & Audio Bus */}
          <div className="flex items-center gap-2">
            <div className="flex items-center p-0.5 rounded-lg bg-white/6">
              {(
                [
                  ['ensemble', 'Ensemble'],
                  ['holonomy', 'Holonomy'],
                  ['synth', '47-Key Synth'],
                  ['kolmogorov', 'Kolmogorov'],
                  ['json', 'Studio · MCP'],
                ] as const
              ).map(([tabId, label]) => (
                <button
                  key={tabId}
                  type="button"
                  onClick={() => setActiveTab(tabId)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === tabId
                      ? 'bg-white/16 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center p-0.5 rounded-lg bg-white/8">
              <button
                type="button"
                onClick={() => void handleAudioMode('synth')}
                aria-label="Synth audio"
                title="Built-in ensemble audio"
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  audioMode === 'synth' ? 'bg-[#ff5a26] text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void handleAudioMode('mic')}
                aria-label="Microphone audio input"
                title="Live microphone input with BPM tracking"
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  audioMode === 'mic' ? 'bg-[#ff5a26] text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Mic className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void handleAudioMode('muted')}
                aria-label="Mute audio"
                title="Mute"
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  audioMode === 'muted' ? 'bg-white/20 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                <VolumeX className="w-3.5 h-3.5" />
              </button>
            </div>

            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.02}
              value={volume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              className="cube-slider w-12 hidden md:block"
            />
          </div>
        </div>

        {/* Inline Queued Bar-8 FOOOF! / Next-Bar Drop Strip */}
        {hud.pendingDrop && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-1.5 bg-amber-500/14 border-b border-amber-300/25 text-xs">
            <div className="flex items-center gap-2 text-amber-100 tabular-nums">
              <span className="font-semibold text-amber-200">
                Queued Drop: &ldquo;{hud.pendingDrop.title}&rdquo;
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[11px] text-amber-200/90">
                {hud.pendingDrop.timing === 'bar-8-fooof' ? 'On Bar-8 FOOOF!' : 'On Next Bar'} ({hud.pendingDrop.barsRemaining}{' '}
                {hud.pendingDrop.barsRemaining === 1 ? 'bar' : 'bars'})
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onFlushPendingDrop}
                className="px-2.5 py-0.5 rounded bg-[#ff5a26] hover:bg-[#e84b1a] text-white text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Drop Now
              </button>
              <button
                type="button"
                onClick={onCancelPendingDrop}
                aria-label="Cancel queued drop"
                className="p-1 rounded bg-white/10 hover:bg-white/20 text-amber-100 transition-colors cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Active Panel Body */}
        <div className="px-3.5 py-2.5">
          {activeTab === 'ensemble' && (
            <div className="space-y-2.5">
              {/* Row 1: Add Marcher (Pick Role + Variant) + Scale + Camera */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    aria-label="New marcher instrument role"
                    value={spawnRole}
                    onChange={(e) => handleSpawnRoleChange(e.target.value as InstrumentRole)}
                    className="px-2 py-1 rounded-md bg-[#1e2433] border border-white/12 text-xs font-medium text-white focus:outline-none focus:border-[#ff5a26]"
                  >
                    {INSTRUMENT_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {INSTRUMENT_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="New marcher sound variant"
                    value={spawnVariant}
                    onChange={(e) => setSpawnVariant(e.target.value)}
                    className="px-2 py-1 rounded-md bg-[#1e2433] border border-white/12 text-xs font-medium text-slate-200 focus:outline-none focus:border-[#ff5a26]"
                  >
                    {ROLE_VARIANTS[spawnRole].map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => onSpawnMarcher(spawnRole, spawnVariant)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#ff5a26] hover:bg-[#e84b1a] active:scale-[0.98] text-white text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Marcher</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select
                    aria-label="Musical scale"
                    value={hud.beatScale}
                    onChange={(e) => onSetScale(e.target.value as MusicalScaleId)}
                    className="px-2 py-1 rounded-md bg-[#1e2433] border border-white/12 text-xs text-slate-200 focus:outline-none focus:border-[#ff5a26]"
                  >
                    {(Object.keys(MUSICAL_SCALE_LABELS) as MusicalScaleId[]).map((s) => (
                      <option key={s} value={s}>
                        {MUSICAL_SCALE_LABELS[s]}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => onCameraPreset('overview')}
                    className="px-2.5 py-1 rounded-md bg-white/8 hover:bg-white/15 text-xs text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Overview
                  </button>
                </div>
              </div>

              {/* Row 2: Active Marchers Strip (4 Drums + 3 Drei Stars Singers) */}
              <div className="flex flex-wrap items-center gap-1.5">
                {hud.marchers.map((m) => {
                  const isSelected = activeChar?.id === m.id;
                  const isStaged = hud.stagedId === m.id;
                  return (
                    <div
                      key={m.id}
                      className={`flex items-center rounded-md border transition-colors ${
                        isSelected
                          ? 'bg-white/14 border-amber-300/60 text-white'
                          : 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/8'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onStageMarcher(isStaged ? null : m.id)}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium whitespace-nowrap cursor-pointer"
                        title={`Click to stage ${m.label} (${INSTRUMENT_ROLE_LABELS[m.role]})`}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{
                            backgroundColor: m.muted ? '#475569' : `hsl(${m.accentHue}, 88%, 62%)`,
                          }}
                        />
                        <span className={m.muted ? 'line-through text-slate-500' : ''}>
                          {INSTRUMENT_ROLE_LABELS[m.role].split(' ')[0]}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={m.muted ? `Unmute ${m.label}` : `Mute ${m.label}`}
                        onClick={() => onUpdateMarcherInstrument(m.id, { muted: !m.muted })}
                        className="px-1.5 py-1 text-[11px] font-mono text-slate-400 hover:text-white border-l border-white/8 cursor-pointer"
                        title={m.muted ? 'Unmute' : 'Mute'}
                      >
                        {m.muted ? 'Off' : 'On'}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Row 3: Selected Marcher 16-Step Pattern + Live Variant & Pitch Paint */}
              {activeChar && (
                <div className="space-y-2 pt-1.5 border-t border-white/8">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-amber-200 font-medium">{activeChar.label}</span>
                      <select
                        aria-label="Selected marcher role"
                        value={activeChar.role}
                        onChange={(e) =>
                          onUpdateMarcherInstrument(activeChar.id, {
                            role: e.target.value as InstrumentRole,
                          })
                        }
                        className="px-2 py-0.5 rounded bg-[#1e2433] border border-white/12 text-xs text-white focus:outline-none focus:border-[#ff5a26]"
                      >
                        {INSTRUMENT_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {INSTRUMENT_ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>

                      <select
                        aria-label="Selected marcher variant"
                        value={activeChar.variant}
                        onChange={(e) =>
                          onUpdateMarcherInstrument(activeChar.id, { variant: e.target.value })
                        }
                        className="px-2 py-0.5 rounded bg-[#1e2433] border border-white/12 text-xs text-slate-200 focus:outline-none focus:border-[#ff5a26]"
                      >
                        {ROLE_VARIANTS[activeChar.role].map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </select>

                      {isSingerRole(activeChar.role) && (
                        <button
                          type="button"
                          onClick={() =>
                            onSetRecordStep(hud.recordStepIndex !== null ? null : 0)
                          }
                          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                            hud.recordStepIndex !== null
                              ? 'bg-[#ff5a26] text-white'
                              : 'bg-white/10 text-slate-200 hover:bg-white/16'
                          }`}
                          title="Arm step-recording: press any of the 47 keys to write notes into this singer"
                        >
                          {hud.recordStepIndex !== null
                            ? `Rec Step ${hud.recordStepIndex + 1} (Play Key)`
                            : 'Record Notes via 47-Key'}
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5">
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <span>Level</span>
                        <input
                          type="range"
                          aria-label="Marcher volume level"
                          min={0.15}
                          max={1.15}
                          step={0.05}
                          value={activeChar.gain}
                          onChange={(e) =>
                            onUpdateMarcherInstrument(activeChar.id, { gain: Number(e.target.value) })
                          }
                          className="cube-slider w-14"
                        />
                      </label>

                      {hud.dancerCount > 1 && (
                        <button
                          type="button"
                          onClick={() => onRemoveMarcher(activeChar.id)}
                          aria-label={`Remove ${activeChar.label}`}
                          title="Remove this marcher"
                          className="p-1 rounded bg-white/8 hover:bg-red-500/25 text-slate-400 hover:text-red-200 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 16-Step Sequencer Bar (4 beats x 4 sixteenths; half-beats align with STEP / step walk!) */}
                  <div className="grid grid-cols-16 gap-1">
                    {activeChar.steps.map((vel, idx) => {
                      const active = vel > 0.05;
                      const isPlayhead = clock.step16 === idx;
                      const isBigStep = idx % 4 === 0;
                      const isSmallStep = idx % 4 === 2;
                      const isRecTarget = hud.recordStepIndex === idx;
                      const noteMidi = isSingerRole(activeChar.role) ? activeChar.notes?.[idx] : null;
                      const noteLabel = typeof noteMidi === 'number' ? midiToNoteName(noteMidi) : '';

                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            if (hud.recordStepIndex !== null && isSingerRole(activeChar.role)) {
                              onSetRecordStep(idx);
                            } else {
                              onToggleStep(idx);
                            }
                          }}
                          className={`h-9 rounded flex flex-col items-center justify-center border text-[10px] font-mono tabular-nums transition-colors cursor-pointer ${
                            isRecTarget
                              ? 'border-amber-300 bg-amber-500/35 text-white'
                              : active
                                ? isPlayhead
                                  ? 'border-white bg-[#ff5a26] text-white'
                                  : 'border-[#ff7a4d]/60 bg-[#ff5a26]/45 text-white hover:bg-[#ff5a26]/65'
                                : isPlayhead
                                  ? 'border-sky-300/70 bg-white/16 text-white'
                                  : isBigStep
                                    ? 'border-white/15 bg-white/[0.08] text-slate-400 hover:bg-white/14'
                                    : 'border-white/8 bg-white/[0.03] text-slate-500 hover:bg-white/10'
                          }`}
                          title={`Step ${idx + 1}${isBigStep ? ' (STEP)' : isSmallStep ? ' (step)' : ''}${noteLabel ? ` · ${noteLabel}` : ''}`}
                        >
                          <span className="leading-none">
                            {active && noteLabel ? noteLabel : isBigStep ? 'S' : isSmallStep ? 's' : '·'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'holonomy' && (
            <div className="space-y-2.5">
              {/* Row 1: Manifold Curvature K, Presets & Berry Phase Readout */}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSetHolonomy({ enabled: !hud.holonomy.enabled })}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      hud.holonomy.enabled
                        ? 'bg-[#ff5a26] text-white'
                        : 'bg-white/10 text-slate-300 hover:bg-white/18'
                    }`}
                  >
                    {hud.holonomy.enabled ? 'Holonomy On' : 'Holonomy Off'}
                  </button>

                  <label className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-white/[0.05] border border-white/10 text-xs tabular-nums">
                    <span className="text-slate-400">Curvature K</span>
                    <input
                      type="range"
                      aria-label="Manifold curvature K"
                      min={-1}
                      max={1}
                      step={0.05}
                      value={hud.holonomy.curvature}
                      onChange={(e) =>
                        onSetHolonomy({ enabled: true, curvature: Number(e.target.value) })
                      }
                      className="cube-slider w-24 sm:w-32"
                    />
                    <span className="font-mono text-sky-200 w-11 text-right">
                      {hud.holonomy.curvature >= 0 ? '+' : ''}
                      {hud.holonomy.curvature.toFixed(2)}
                    </span>
                  </label>

                  <div className="flex items-center gap-1">
                    {(
                      [
                        ['Flat 0', 0],
                        ['Berry +0.35', 0.35],
                        ['Trefoil +0.72', 0.72],
                        ['Invert -0.55', -0.55],
                      ] as const
                    ).map(([label, val]) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => onSetHolonomy({ enabled: val !== 0, curvature: val })}
                        className="px-2 py-1 rounded bg-white/8 hover:bg-white/16 text-[11px] font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-amber-200 tabular-nums px-2 py-1 rounded bg-white/[0.05] border border-white/10">
                    θ = {hud.holonomyThetaDeg}°
                  </span>
                  <button
                    type="button"
                    onClick={onResetHolonomyPhase}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/8 hover:bg-white/16 text-xs text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    title="Reset accumulated Berry phase θ to 0°"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset θ</span>
                  </button>
                </div>
              </div>

              {/* Row 2: Parallel-Transport Musical Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/8 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onSetHolonomy({
                        rhythmRotatePerOrbit: !hud.holonomy.rhythmRotatePerOrbit,
                      })
                    }
                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      hud.holonomy.rhythmRotatePerOrbit
                        ? 'bg-sky-500/25 border border-sky-300/40 text-sky-100'
                        : 'bg-white/8 border border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Rotate 16-Step Rhythm: {hud.holonomy.rhythmRotatePerOrbit ? 'On' : 'Off'}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onSetHolonomy({
                        harmonyTransposePerOrbit: !hud.holonomy.harmonyTransposePerOrbit,
                      })
                    }
                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      hud.holonomy.harmonyTransposePerOrbit
                        ? 'bg-amber-500/25 border border-amber-300/40 text-amber-100'
                        : 'bg-white/8 border border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Scale Parallel-Transport: {hud.holonomy.harmonyTransposePerOrbit ? 'On' : 'Off'}
                  </button>
                </div>

                <label className="flex items-center gap-2 text-[11px] text-slate-300 tabular-nums">
                  <span className="text-slate-400">Timbre Morph</span>
                  <input
                    type="range"
                    aria-label="Holonomy timbre morph"
                    min={0}
                    max={1}
                    step={0.05}
                    value={hud.holonomy.timbreMorph}
                    onChange={(e) => onSetHolonomy({ timbreMorph: Number(e.target.value) })}
                    className="cube-slider w-20"
                  />
                  <span className="font-mono text-slate-200 w-8 text-right">
                    {Math.round(hud.holonomy.timbreMorph * 100)}%
                  </span>
                </label>
              </div>

              {/* Row 3: Spatial Curvature Wells on the Campfire Floor */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={hud.holonomy.wells.length >= 4}
                    onClick={() => onAddCurvatureWell(0.75)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-500/20 hover:bg-sky-500/32 disabled:opacity-40 border border-sky-300/30 text-xs font-medium text-sky-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Positive Well (+K)</span>
                  </button>
                  <button
                    type="button"
                    disabled={hud.holonomy.wells.length >= 4}
                    onClick={() => onAddCurvatureWell(-0.75)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-orange-500/20 hover:bg-orange-500/32 disabled:opacity-40 border border-orange-300/30 text-xs font-medium text-orange-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Negative Well (-K)</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {hud.holonomy.wells.length === 0 ? (
                    <span className="text-[11px] text-slate-400">
                      No local wells · Add up to 4 crystal curvature spires around the ring
                    </span>
                  ) : (
                    hud.holonomy.wells.map((w, idx) => {
                      const deg = Math.round((w.angle * 180) / Math.PI);
                      const isPos = w.strength >= 0;
                      return (
                        <div
                          key={w.id}
                          className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-mono tabular-nums ${
                            isPos
                              ? 'bg-sky-500/14 border-sky-300/30 text-sky-100'
                              : 'bg-orange-500/14 border-orange-300/30 text-orange-100'
                          }`}
                        >
                          <span>
                            W{idx + 1} {deg}° · {isPos ? '+' : ''}
                            {w.strength.toFixed(2)}
                          </span>
                          <button
                            type="button"
                            onClick={() => onRemoveCurvatureWell(w.id)}
                            aria-label={`Remove well ${idx + 1}`}
                            className="hover:text-white cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'synth' && (
            <div className="space-y-2">
              {/* Row 1: Synth Voice, Keyboard Mapping Layout, Octave, & Filter/Envelope Knobs */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    aria-label="Synth voice"
                    value={zynParams.patch}
                    onChange={(e) => updateZyn({ patch: e.target.value as ZynPatchId })}
                    className="px-2.5 py-1 rounded-md bg-[#1e2433] border border-white/12 text-xs font-medium text-white focus:outline-none focus:border-[#ff5a26]"
                  >
                    {(Object.keys(ZYN_PATCH_LABELS) as ZynPatchId[]).map((id) => (
                      <option key={id} value={id}>
                        {ZYN_PATCH_LABELS[id]}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="47-key layout"
                    value={hud.midiLayout}
                    onChange={(e) => onMidiLayoutChange(e.target.value as Midi47LayoutId)}
                    className="px-2.5 py-1 rounded-md bg-[#1e2433] border border-white/12 text-xs font-medium text-slate-200 focus:outline-none focus:border-[#ff5a26]"
                  >
                    {(Object.keys(MIDI47_LAYOUT_LABELS) as Midi47LayoutId[]).map((id) => (
                      <option key={id} value={id}>
                        {MIDI47_LAYOUT_LABELS[id]}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center p-0.5 rounded-md bg-white/8 text-[11px]">
                    {([-1, 0, 1] as const).map((oct) => (
                      <button
                        key={oct}
                        type="button"
                        onClick={() => updateZyn({ octave: oct })}
                        className={`px-2 py-0.5 rounded font-mono transition-colors cursor-pointer ${
                          zynParams.octave === oct
                            ? 'bg-white text-[#141822] font-semibold'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        {oct > 0 ? `+${oct}` : oct}
                      </button>
                    ))}
                  </div>

                  {hud.lastMidiNote && (
                    <span className="font-mono text-[11px] text-slate-300 tabular-nums pl-1">
                      {hud.lastMidiNote}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300 tabular-nums">
                  <label className="flex items-center gap-1.5" title={`Cutoff ${formatHz(zynParams.cutoff)}`}>
                    <span className="text-slate-400">Cutoff</span>
                    <input
                      type="range"
                      min={320}
                      max={6400}
                      step={80}
                      value={zynParams.cutoff}
                      onChange={(e) => updateZyn({ cutoff: Number(e.target.value) })}
                      className="cube-slider w-14"
                    />
                  </label>
                  <label className="flex items-center gap-1.5" title={`Resonance ${zynParams.resonance.toFixed(1)}`}>
                    <span className="text-slate-400">Res</span>
                    <input
                      type="range"
                      min={0.5}
                      max={9.5}
                      step={0.3}
                      value={zynParams.resonance}
                      onChange={(e) => updateZyn({ resonance: Number(e.target.value) })}
                      className="cube-slider w-12"
                    />
                  </label>
                  <label className="flex items-center gap-1.5" title={`Detune ${zynParams.detune} cents`}>
                    <span className="text-slate-400">Detune</span>
                    <input
                      type="range"
                      min={0}
                      max={28}
                      step={1}
                      value={zynParams.detune}
                      onChange={(e) => updateZyn({ detune: Number(e.target.value) })}
                      className="cube-slider w-12"
                    />
                  </label>
                  <label className="flex items-center gap-1.5" title={`Release ${zynParams.release.toFixed(2)}s`}>
                    <span className="text-slate-400">Release</span>
                    <input
                      type="range"
                      min={0.14}
                      max={2.0}
                      step={0.06}
                      value={zynParams.release}
                      onChange={(e) => updateZyn({ release: Number(e.target.value) })}
                      className="cube-slider w-12"
                    />
                  </label>
                </div>
              </div>

              {/* Row 2: Full 47-Key ANSI Polyphonic QWERTY-to-MIDI Matrix */}
              <Keyboard47
                layout={hud.midiLayout}
                octaveShift={zynParams.octave}
                activeCodes={activeCodesSet}
                onTriggerKey={onTriggerKey47}
              />

              {/* Row 3: Compact Beat Quantization & Band Threshold Snap Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/8">
                <div className="flex items-center gap-2">
                  <div className="flex items-center p-0.5 rounded-md bg-white/8 text-[11px]">
                    <button
                      type="button"
                      onClick={() => updateBrainMeta({ vfxTriggerMode: 'on-beat' })}
                      className={`px-2.5 py-0.5 rounded font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        currentTriggerMode === 'on-beat'
                          ? 'bg-[#ff5a26] text-white'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      On Beat
                    </button>
                    <button
                      type="button"
                      onClick={() => updateBrainMeta({ vfxTriggerMode: 'single' })}
                      className={`px-2.5 py-0.5 rounded font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        currentTriggerMode === 'single'
                          ? 'bg-[#ff5a26] text-white'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Single
                    </button>
                  </div>

                  <div className="flex items-center p-0.5 rounded-md bg-white/8">
                    {(['bass', 'mid', 'treble'] as const).map((band) => (
                      <button
                        key={band}
                        type="button"
                        onClick={() => updateBrainMeta({ snapBand: band })}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium capitalize transition-colors cursor-pointer ${
                          currentSnapBand === band
                            ? 'bg-white text-[#141822]'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        {band}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2.5 flex-1 min-w-[200px] max-w-[380px]">
                  <div className="relative h-2 flex-1 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-transform duration-75 origin-left"
                      style={{
                        transform: `scaleX(${Math.max(0.04, Math.min(1, activeSnapEnergy))})`,
                        backgroundColor:
                          activeSnapEnergy >= currentThreshold ? '#ff5a26' : '#5f87eb',
                      }}
                    />
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-white"
                      style={{ left: `${currentThreshold * 100}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap">Threshold</span>
                  <input
                    type="range"
                    aria-label="Trigger threshold"
                    min={0.12}
                    max={0.92}
                    step={0.02}
                    value={currentThreshold}
                    onChange={(e) => updateBrainMeta({ snapThreshold: Number(e.target.value) })}
                    className="cube-slider w-20"
                  />
                  <span className="font-mono text-[11px] text-slate-300 tabular-nums w-8 text-right">
                    {Math.round(currentThreshold * 100)}%
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'kolmogorov' && (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    applySeedString(seedInput);
                  }}
                  className="flex items-center gap-1.5 flex-1 min-w-[220px]"
                >
                  <input
                    type="text"
                    aria-label="Kolmogorov seed"
                    value={seedInput}
                    onChange={(e) => setSeedInput(e.target.value)}
                    placeholder="Seed string..."
                    className="w-full px-2.5 py-1.5 rounded-md bg-white/8 border border-white/12 text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-[#ff5a26]"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-md bg-white/12 hover:bg-white/20 text-xs font-medium text-white whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={mutateBrain}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-white/12 hover:bg-white/20 text-xs font-medium text-white whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                    <span>Mutate</span>
                  </button>
                </form>

                <div className="flex items-center gap-3.5 text-xs text-slate-300">
                  <label className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="text-slate-400">Complexity</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={hud.stagedBrain.complexity}
                      onChange={(e) => updateBrainMeta({ complexity: Number(e.target.value) })}
                      className="cube-slider w-16"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="text-slate-400">Vertex Snap</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={hud.stagedBrain.jankLevel}
                      onChange={(e) => updateBrainMeta({ jankLevel: Number(e.target.value) })}
                      className="cube-slider w-16"
                    />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {([0, 1, 2] as const).map((idx) => {
                  const sp = hud.stagedBrain.shapes[idx];
                  const energy = Math.min(1, bandValues[idx]);
                  const bandWord = idx === 0 ? 'Bass' : idx === 1 ? 'Mid' : 'Treble';
                  return (
                    <div
                      key={idx}
                      className="flex flex-col gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/8"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: `hsl(${sp.hue}, 88%, 58%)` }}
                          />
                          <span className="text-xs font-medium text-slate-200">{bandWord}</span>
                        </div>
                        <select
                          aria-label={`${bandWord} geometry`}
                          value={sp.kind}
                          onChange={(e) => updateShapeField(idx, { kind: e.target.value as BrainShapeKind })}
                          className="px-2 py-0.5 rounded bg-[#1e2433] border border-white/12 text-xs text-slate-100 focus:outline-none focus:border-[#ff5a26]"
                        >
                          {BRAIN_SHAPE_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {BRAIN_SHAPE_LABELS[k]}
                            </option>
                          ))}
                        </select>
                      </div>

                      <input
                        type="range"
                        aria-label={`${bandWord} hue`}
                        min={0}
                        max={350}
                        step={10}
                        value={sp.hue}
                        onChange={(e) => updateShapeField(idx, { hue: Number(e.target.value) })}
                        className="cube-slider w-full"
                      />

                      <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-transform duration-75 origin-left"
                          style={{
                            transform: `scaleX(${Math.max(0.06, energy)})`,
                            backgroundColor: `hsl(${sp.hue}, 88%, 58%)`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'json' && (
            <div className="space-y-2">
              {/* Row 1: Presets with Bar-8 FOOOF! Quantized Drop Mode + Share / Capture */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="flex items-center p-0.5 rounded-md bg-white/8 text-[11px]">
                    {(
                      [
                        ['now', 'Load Now'],
                        ['bar-8-fooof', 'Bar-8 FOOOF!'],
                        ['next-bar', 'Next Bar'],
                      ] as const
                    ).map(([timing, label]) => (
                      <button
                        key={timing}
                        type="button"
                        onClick={() => setDropTiming(timing)}
                        className={`px-2 py-0.5 rounded font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          dropTiming === timing
                            ? 'bg-amber-400 text-[#141822] font-semibold'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {Object.entries(BEAT_PRESETS).map(([key, preset]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setJsonDraft(JSON.stringify(preset, null, 2));
                        if (dropTiming === 'now') {
                          onLoadBeatDocument(preset);
                          setJsonStatus({ kind: 'ok', text: `Loaded "${preset.title}"` });
                        } else {
                          onQueueBeatDrop(preset, dropTiming);
                          setJsonStatus({
                            kind: 'ok',
                            text: `Queued "${preset.title}" for ${dropTiming === 'bar-8-fooof' ? 'Bar-8 FOOOF!' : 'next bar'}`,
                          });
                        }
                      }}
                      className="px-2.5 py-1 rounded-md bg-white/8 hover:bg-white/16 text-xs text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {preset.title}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleShareCartridge()}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/18 text-xs font-medium text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    title="Compress entire beat + holonomy into a shareable #beat= URL cartridge"
                  >
                    <Link2 className="w-3.5 h-3.5 text-sky-300" />
                    <span>{shareNote ?? 'Share #beat= Link'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void onToggleVideoRecording()}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                      hud.recorder.isRecording
                        ? 'bg-[#ff5a26] hover:bg-[#e84b1a] text-white'
                        : 'bg-white/10 hover:bg-white/18 text-slate-100'
                    }`}
                  >
                    {hud.recorder.isRecording ? (
                      <>
                        <Square className="w-3 h-3 fill-current" />
                        <span>Stop {formatRecClock(hud.recorder.elapsedSec)}</span>
                      </>
                    ) : (
                      <>
                        <Video className="w-3.5 h-3.5 text-[#ff7a4d]" />
                        <span>Record Video</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleExportMidi}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/18 text-xs font-medium text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    title="Export 8-bar Format-1 multi-track Standard MIDI File (GM Ch 10 drums + Ch 1-3 singers)"
                  >
                    <Download className="w-3.5 h-3.5 text-amber-300" />
                    <span>Export .mid</span>
                  </button>
                </div>
              </div>

              {/* Row 2: Two-Way Hardware WebMIDI In/Out Hub */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/8 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void onReconnectWebMidi()}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white/10 hover:bg-white/18 text-xs font-medium text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Cable className="w-3.5 h-3.5 text-emerald-300" />
                    <span>
                      {hud.midiHub.connected
                        ? `WebMIDI (${hud.midiHub.inputs.length} in · ${hud.midiHub.outputs.length} out)`
                        : hud.midiHub.supported
                          ? 'Connect WebMIDI'
                          : 'WebMIDI Unavailable'}
                    </span>
                  </button>

                  {hud.midiHub.outputs.length > 0 && (
                    <select
                      aria-label="MIDI output port"
                      value={hud.midiHub.selectedOutputId ?? ''}
                      onChange={(e) => onSetMidiOutputPort(e.target.value || null)}
                      className="px-2 py-1 rounded bg-[#1e2433] border border-white/12 text-xs text-slate-200 focus:outline-none focus:border-[#ff5a26]"
                    >
                      <option value="">Select MIDI Out...</option>
                      {hud.midiHub.outputs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    disabled={hud.midiHub.outputs.length === 0}
                    onClick={() => onSetMidiOutEnabled(!hud.midiHub.midiOutEnabled)}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      hud.midiHub.midiOutEnabled
                        ? 'bg-emerald-500/25 border border-emerald-300/40 text-emerald-100'
                        : 'bg-white/8 text-slate-300 hover:text-white'
                    }`}
                  >
                    MIDI Out: {hud.midiHub.midiOutEnabled ? 'On' : 'Off'}
                  </button>
                </div>

                <span className="font-mono text-[11px] text-slate-400 truncate max-w-[340px]">
                  {hud.midiHub.lastMessage ?? 'CC#74 Cutoff · CC#71 Res · CC#72 Rel · CC#1 Curvature'}
                </span>
              </div>

              {/* Row 3: Beat JSON Editor + Apply / Queue Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleCopySchema}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/8 hover:bg-white/16 text-xs text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {copiedSchema ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedSchema ? 'Copied Schema' : 'Copy Schema'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyLiveJson}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/8 hover:bg-white/16 text-xs text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {copiedJson ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedJson ? 'Copied Beat' : 'Copy JSON'}</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleApplyBeatJson('bar-8-fooof')}
                    className="px-2.5 py-1 rounded-md bg-amber-400/20 hover:bg-amber-400/32 border border-amber-300/35 text-xs font-medium text-amber-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Queue Bar-8 Drop
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyBeatJson('now')}
                    className="px-3 py-1 rounded-md bg-[#ff5a26] hover:bg-[#e84b1a] text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Apply Now
                  </button>
                  <button
                    type="button"
                    onClick={onClearRing}
                    className="px-2.5 py-1 rounded-md bg-white/8 hover:bg-red-500/25 text-xs text-slate-300 hover:text-red-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Clear Ring
                  </button>
                </div>
              </div>

              <textarea
                aria-label="Beat JSON Document"
                value={jsonDraft}
                onChange={(e) => setJsonDraft(e.target.value)}
                rows={4}
                spellCheck={false}
                className="w-full px-2.5 py-2 rounded-lg bg-[#0d1119] border border-white/10 font-mono text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-[#ff5a26] resize-y"
              />

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-300 font-medium">
                    WebMCP {hud.webMcp.nativeAvailable ? 'navigator.modelContext' : 'window.clearCubeWebMCP'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-slate-400">
                    {hud.webMcp.toolNames.length} tools ({hud.webMcp.toolNames.slice(0, 4).join(', ')}…)
                  </span>
                  {hud.webMcp.lastCall && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-amber-300">Last: {hud.webMcp.lastCall}</span>
                    </>
                  )}
                </div>

                {(jsonStatus || hud.recorder.error || hud.recorder.lastSavedFilename) && (
                  <span
                    className={
                      hud.recorder.error || jsonStatus?.kind === 'err'
                        ? 'text-red-300'
                        : 'text-emerald-300'
                    }
                  >
                    {hud.recorder.error ??
                      jsonStatus?.text ??
                      (hud.recorder.lastSavedFilename ? `Saved ${hud.recorder.lastSavedFilename}` : '')}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
