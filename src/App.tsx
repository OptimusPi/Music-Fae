import { useEffect, useRef, useState } from 'react';
import { soundEngine } from './audio/soundEngine';
import { ControlDock } from './components/ControlDock';
import { HudSnapshot, PlaygroundScene } from './scene/PlaygroundScene';
import {
  DEFAULT_BEAT_DOCUMENT,
  DEFAULT_BPM,
  bpmToAnimFps,
} from './shared/beatSchema';
import { decodeKolmogorov } from './shared/protocol';

const INITIAL_HUD: HudSnapshot = {
  connectionStatus: 'connecting',
  clientCount: 1,
  dancerCount: 7,
  stagedId: null,
  stagedLabel: null,
  stagedCharacter: null,
  stagedBrain: decodeKolmogorov('sunny-moss'),
  marchers: [],
  beatTitle: DEFAULT_BEAT_DOCUMENT.title,
  beatScale: DEFAULT_BEAT_DOCUMENT.scale,
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
  recordTarget: null,
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

  return (
    <main className="relative w-full h-full overflow-hidden bg-[#111a28]">
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

      <ControlDock
        hud={hud}
        onSetBpm={(bpm) => sceneRef.current?.setBpm(bpm)}
        onSetScale={(scale) => sceneRef.current?.setBeatScale(scale)}
        onSpawnMarcher={(role, variant) => sceneRef.current?.spawnMarcher(role, variant)}
        onStageMarcher={(id) => sceneRef.current?.stageCharacter(id)}
        onRemoveMarcher={(id) => sceneRef.current?.removeMarcherById(id)}
        onUpdateMarcherInstrument={(id, patch) =>
          sceneRef.current?.updateMarcherInstrument(id, patch)
        }
        onSetMarcherStep={(id, idx, active) =>
          sceneRef.current?.setMarcherStep(id, idx, active)
        }
        onNudgeMarcherNote={(id, idx, delta) =>
          sceneRef.current?.nudgeMarcherStepNote(id, idx, delta)
        }
        onClearAllSteps={() => sceneRef.current?.clearAllSteps()}
        onSetRecordTarget={(target) => sceneRef.current?.setRecordTarget(target)}
        onUpdateBrain={(brain, replayBoot) =>
          sceneRef.current?.updateStagedBrain(brain, replayBoot)
        }
        onMidiLayoutChange={(layout) => sceneRef.current?.setMidiLayout(layout)}
        onTriggerKey47={(code, midi) => sceneRef.current?.triggerKey47FromPointer(code, midi)}
        onLoadBeatDocument={(doc) => sceneRef.current?.loadBeatDocument(doc)}
        onCreateShareUrl={() =>
          sceneRef.current ? sceneRef.current.createShareCartridgeUrl() : Promise.resolve(null)
        }
        onToggleVideoRecording={() =>
          sceneRef.current ? sceneRef.current.toggleVideoRecording() : Promise.resolve()
        }
        onExportMidi={() => sceneRef.current?.exportMidiFile() ?? ''}
      />
    </main>
  );
}
