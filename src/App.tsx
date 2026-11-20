import { useEffect, useRef, useState } from 'react';
import { DANCE_BREAK_LABELS, soundEngine } from './audio/soundEngine';
import { ControlDock } from './components/ControlDock';
import { HudSnapshot, PlaygroundScene } from './scene/PlaygroundScene';
import {
  DEFAULT_BEAT_DOCUMENT,
  DEFAULT_BPM,
  DEFAULT_HOLONOMY,
  INSTRUMENT_ROLE_LABELS,
  bpmToAnimFps,
} from './shared/beatSchema';
import { decodeKolmogorov } from './shared/protocol';

function formatRecTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const INITIAL_HUD: HudSnapshot = {
  connectionStatus: 'connecting',
  clientCount: 1,
  dancerCount: 7,
  stagedId: null,
  stagedLabel: null,
  stagedCharacter: null,
  stagedBrain: decodeKolmogorov('CRYSTAL-FAE-HEARTH'),
  marchers: [],
  beatTitle: DEFAULT_BEAT_DOCUMENT.title,
  beatScale: DEFAULT_BEAT_DOCUMENT.scale,
  holonomy: { ...DEFAULT_HOLONOMY, wells: [] },
  holonomyThetaDeg: 0,
  pendingDrop: null,
  audioBands: { bass: 0.2, mid: 0.2, treble: 0.2, overall: 0.2, beatPulse: 0 },
  musicalClock: {
    bpm: DEFAULT_BPM,
    animFps: bpmToAnimFps(DEFAULT_BPM),
    exactBeats: 0,
    barInPhrase: 1,
    beatInBar: 1,
    step16: 0,
    halfBeatIndex: 0,
    campfireBeat: 0,
    phraseIndex: 0,
    totalBeats: 0,
    isBreakBar: false,
    breakStyle: 'wave',
    breakProgress: 0,
    beatPhase: 0,
    justHitBeat: false,
  },
  midiLayout: 'vmpk',
  activeKeyCodes: [],
  lastMidiNote: null,
  recordStepIndex: null,
  midiHub: {
    supported: false,
    connected: false,
    inputs: [],
    outputs: [],
    selectedOutputId: null,
    midiOutEnabled: false,
    lastMessage: null,
  },
  recorder: {
    isRecording: false,
    elapsedSec: 0,
    lastSavedFilename: null,
    error: null,
  },
  webMcp: { nativeAvailable: false, toolNames: [], lastCall: null },
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<PlaygroundScene | null>(null);
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    let engine: PlaygroundScene | null = null;
    try {
      engine = new PlaygroundScene(mount, (nextHud) => {
        setHud(nextHud);
      });
      sceneRef.current = engine;
      setInitError(null);
    } catch (err) {
      console.error('Failed to initialize Clear Cube Playground:', err);
      setInitError(err instanceof Error ? err.message : 'Unable to initialize WebGL context.');
    }

    return () => {
      engine?.dispose();
      sceneRef.current = null;
      soundEngine.dispose();
    };
  }, []);

  const clock = hud.musicalClock;
  const staged = hud.stagedId ? hud.stagedCharacter : null;
  const holonomyActive =
    hud.holonomy.enabled &&
    (Math.abs(hud.holonomy.curvature) > 0.01 || hud.holonomy.wells.length > 0);

  return (
    <main className="relative w-full h-full overflow-hidden bg-[#111a28]">
      {/* Isolated WebGL Viewport */}
      <div
        ref={canvasMountRef}
        className="fixed inset-0 w-full h-full cursor-grab active:cursor-grabbing"
      />

      {initError && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#111a28] p-6">
          <div className="max-w-md rounded-xl bg-[#141822] text-slate-100 border border-white/12 p-6 shadow-2xl">
            <h2 className="font-display text-lg font-bold text-white">WebGL Unavailable</h2>
            <p className="mt-2 text-sm text-slate-300 leading-relaxed">{initError}</p>
          </div>
        </div>
      )}

      {/* Unboxed Moonlit Header */}
      <header className="fixed top-5 left-6 z-10 pointer-events-none select-none">
        <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-100">
          Drei Stars · Clear Cube
        </h1>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-300 tabular-nums">
          <span>{hud.dancerCount} Marchers</span>
          <span aria-hidden="true">·</span>
          <span>{clock.bpm} bpm</span>
          <span aria-hidden="true">·</span>
          <span>{clock.animFps.toFixed(1)} fps</span>
          <span aria-hidden="true">·</span>
          <span className={clock.isBreakBar ? 'text-amber-300 font-semibold' : ''}>
            {clock.isBreakBar
              ? `Bar 8/8 · ${DANCE_BREAK_LABELS[clock.breakStyle]}`
              : `Bar ${clock.barInPhrase}/8`}
          </span>
          {holonomyActive && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-sky-300">
                θ {hud.holonomyThetaDeg}°
              </span>
            </>
          )}
          {hud.pendingDrop && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-amber-300 font-semibold">
                Drop &ldquo;{hud.pendingDrop.title}&rdquo; in {hud.pendingDrop.barsRemaining}b
              </span>
            </>
          )}
          {hud.recorder.isRecording && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[#ff7a4d] font-semibold">
                Rec {formatRecTime(hud.recorder.elapsedSec)}
              </span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span className={staged ? 'font-mono text-amber-200' : 'text-slate-400'}>
            {staged
              ? `${staged.label} · ${INSTRUMENT_ROLE_LABELS[staged.role]} (${staged.variant})`
              : 'Click any head to stage'}
          </span>
        </div>
      </header>

      {/* Unified Collapsible Studio Instrument, Holonomy, Ensemble & WebMCP Console */}
      <ControlDock
        hud={hud}
        onSetBpm={(bpm) => sceneRef.current?.setBpm(bpm)}
        onSetScale={(scale) => sceneRef.current?.setBeatScale(scale)}
        onSpawnMarcher={(role, variant) => sceneRef.current?.spawnMarcher(role, variant)}
        onStageMarcher={(id) => sceneRef.current?.stageCharacter(id)}
        onStageNext={() => sceneRef.current?.stageNextDancer()}
        onRemoveMarcher={(id) => sceneRef.current?.removeMarcherById(id)}
        onUpdateMarcherInstrument={(id, patch) =>
          sceneRef.current?.updateMarcherInstrument(id, patch)
        }
        onToggleStep={(idx) => sceneRef.current?.toggleStagedStep(idx)}
        onSetRecordStep={(idx) => sceneRef.current?.setRecordStepIndex(idx)}
        onUpdateBrain={(brain, replayBoot) =>
          sceneRef.current?.updateStagedBrain(brain, replayBoot)
        }
        onTriggerBoot={() => sceneRef.current?.triggerBootSequence()}
        onClearRing={() => sceneRef.current?.clearRing()}
        onCameraPreset={(preset) => sceneRef.current?.setCameraPreset(preset)}
        onMidiLayoutChange={(layout) => sceneRef.current?.setMidiLayout(layout)}
        onTriggerKey47={(code, midi) => sceneRef.current?.triggerKey47FromPointer(code, midi)}
        onGetBeatDocument={() =>
          sceneRef.current?.getBeatDocument() ?? DEFAULT_BEAT_DOCUMENT
        }
        onLoadBeatDocument={(doc) => sceneRef.current?.loadBeatDocument(doc)}
        onQueueBeatDrop={(doc, timing) => sceneRef.current?.queueBeatDrop(doc, timing)}
        onFlushPendingDrop={() => sceneRef.current?.flushPendingDropNow()}
        onCancelPendingDrop={() => sceneRef.current?.cancelPendingDrop()}
        onSetHolonomy={(patch) => sceneRef.current?.setHolonomy(patch)}
        onAddCurvatureWell={(strength) => sceneRef.current?.addCurvatureWell(strength)}
        onRemoveCurvatureWell={(id) => sceneRef.current?.removeCurvatureWell(id)}
        onResetHolonomyPhase={() => sceneRef.current?.resetHolonomyPhase()}
        onCreateShareUrl={() =>
          sceneRef.current ? sceneRef.current.createShareCartridgeUrl() : Promise.resolve(null)
        }
        onReconnectWebMidi={() =>
          sceneRef.current ? sceneRef.current.reconnectWebMidi() : Promise.resolve()
        }
        onSetMidiOutputPort={(id) => sceneRef.current?.setMidiOutputPort(id)}
        onSetMidiOutEnabled={(enabled) => sceneRef.current?.setMidiOutEnabled(enabled)}
        onToggleVideoRecording={() =>
          sceneRef.current ? sceneRef.current.toggleVideoRecording() : Promise.resolve()
        }
        onExportMidi={() => sceneRef.current?.exportMidiFile() ?? ''}
      />
    </main>
  );
}
