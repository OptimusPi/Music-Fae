import * as THREE from 'three';
import {
  Midi47LayoutId,
  isAnsi47Code,
  resolveKey47,
} from '../audio/midi47';
import { MidiHubSnapshot, WebMidiHub } from '../audio/midiBridge';
import {
  AudioBands,
  MidiNoteResult,
  MusicalClock,
  soundEngine,
} from '../audio/soundEngine';
import {
  StudioRecorderState,
  StudioVideoRecorder,
  downloadMidiFromBeat,
} from '../audio/studioExport';
import { ConnectionStatus, RoomClient } from '../net/roomClient';
import {
  BeatDocument,
  BeatMarcherSpec,
  DEFAULT_BEAT_DOCUMENT,
  DREI_STAR_HUES,
  INSTRUMENT_ROLE_LABELS,
  InstrumentRole,
  MusicalScaleId,
  SCALE_INTERVALS,
  buildBrainFromBeatMarcher,
  buildCharactersFromBeatDocument,
  exportBeatDocumentFromCharacters,
  getDefaultNotesForRole,
  getDefaultSeedForRole,
  getDefaultStepsForRole,
  getDefaultVariantForRole,
  isSingerRole,
  isValidVariantForRole,
  normalizeNotes16,
  normalizeSteps16,
} from '../shared/beatSchema';
import {
  CharacterState,
  KolmogorovBrain,
  ServerToClientMessage,
  createSpawnCharacter,
  decodeKolmogorov,
  encodeKolmogorov,
  sanitizeFriendlyLabel,
} from '../shared/protocol';
import {
  EncodedCartridge,
  decodeBeatFromUrlHash,
  encodeBeatToUrlCartridge,
} from '../shared/urlCartridge';
import { MusicalCampfire } from './campfire';
import { CharacterRig } from './characterRig';
import { WorldHandles, buildCubeWorld } from './cubeWorld';
import { DreiStars } from './dreiStars';

export interface MarcherSummary {
  id: string;
  label: string;
  role: InstrumentRole;
  variant: string;
  muted: boolean;
  gain: number;
  accentHue: number;
  steps: number[];
  notes?: Array<number | null>;
}

export interface RecordStepTarget {
  id: string;
  stepIdx: number;
}

export interface HudSnapshot {
  connectionStatus: ConnectionStatus;
  clientCount: number;
  dancerCount: number;
  stagedId: string | null;
  stagedLabel: string | null;
  stagedCharacter: CharacterState | null;
  stagedBrain: KolmogorovBrain;
  marchers: MarcherSummary[];
  beatTitle: string;
  beatScale: MusicalScaleId;
  audioBands: AudioBands;
  musicalClock: MusicalClock;
  midiLayout: Midi47LayoutId;
  activeKeyCodes: string[];
  lastMidiNote: string | null;
  recordTarget: RecordStepTarget | null;
  midiHub: MidiHubSnapshot;
  recorder: StudioRecorderState;
}

interface SparkParticle {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  gravity: number;
}

interface QueuedMidiVfx {
  targetId: string | null;
  hue: number;
  strength: number;
}

function detectSoftwareGl(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

export class PlaygroundScene {
  private container: HTMLElement;
  private onHudUpdate: (hud: HudSnapshot) => void;
  private isSoftwareGl: boolean;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private world: WorldHandles;
  private campfire: MusicalCampfire;
  private dreiStars: DreiStars;

  private clientId: string;
  private roomClient: RoomClient;
  private connectionStatus: ConnectionStatus = 'connecting';
  private clientCount = 1;

  private characters = new Map<string, CharacterState>();
  private rigs = new Map<string, CharacterRig>();
  private stagedId: string | null = null;
  private stageSpotX = 0;
  private stageSpotZ = 2.45;
  private spawnCounter = 0;
  private beatTitle = DEFAULT_BEAT_DOCUMENT.title;
  private hasLoadedUrlCartridge = false;

  // Optional step-recording cursor when Shift-clicking / double-clicking a singer cell
  private recordTarget: RecordStepTarget | null = null;

  // 47-Key ANSI QWERTY + Two-Way WebMIDI Hub + Studio Recorder
  private midiLayout: Midi47LayoutId = 'vmpk';
  private pressedCodes = new Set<string>();
  private lastMidiNote: string | null = null;
  private queuedMidiVfx: QueuedMidiVfx[] = [];
  private midiHub: WebMidiHub;
  private midiHubSnapshot: MidiHubSnapshot;
  private studioRecorder = new StudioVideoRecorder();

  // 8-bar group choreography & direction reversal tracking
  private lastPhraseIndex = 0;
  private wasBreakBar = false;

  // Pointer orbit, hover cursor & click-to-stage raycasting
  private isPointerDown = false;
  private pointerDownX = 0;
  private pointerDownY = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private camYaw = 0.42;
  private camPitch = 0.42;
  private camDistance = 17.8;
  private targetCamYaw = 0.42;
  private targetCamPitch = 0.42;
  private targetCamDistance = 17.8;
  private camLookTarget = new THREE.Vector3(0, 1.8, 0);

  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private hoveringHead = false;

  // Shared crystal spark particle pool for 47-key MIDI & staging bursts
  private sparkParticles: SparkParticle[] = [];
  private sparkGeo = new THREE.OctahedronGeometry(0.14, 0);

  // Loop & lifecycle
  private frameId = 0;
  private disposed = false;
  private lastTimeMs = performance.now();
  private startTimeMs = performance.now();
  private lastHudPushMs = 0;

  private readonly _desiredCamPos = new THREE.Vector3();
  private readonly _desiredLook = new THREE.Vector3();

  constructor(container: HTMLElement, onHudUpdate: (hud: HudSnapshot) => void) {
    this.container = container;
    this.onHudUpdate = onHudUpdate;
    this.isSoftwareGl = detectSoftwareGl();

    this.clientId = `fae-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    this.scene = new THREE.Scene();
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 240);
    this.camera.position.set(11, 10.5, 16);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(this.renderer.domElement);

    this.world = buildCubeWorld(this.scene, this.renderer, this.isSoftwareGl);

    // Central animated musical campfire at (0, 0, 0)
    this.campfire = new MusicalCampfire(this.isSoftwareGl);
    this.scene.add(this.campfire.root);

    // Drei Stars celestial tri-star constellation linked to Bass / Melody / Harmony singers
    this.dreiStars = new DreiStars();
    this.scene.add(this.dreiStars.root);

    // Two-way WebMIDI Hub (MIDI In notes + CC knobs; MIDI Out 4 drums Ch10 + 3 singers Ch1..3)
    this.midiHub = new WebMidiHub();
    this.midiHubSnapshot = this.midiHub.getSnapshot();
    void this.midiHub.connect({
      onNoteOn: (midi, velocity) => {
        this.triggerMidiNote(midi, velocity);
      },
      onControlChange: (cc, norm) => {
        this.handleMidiControlChange(cc, norm);
      },
      onStatusChange: (snap) => {
        this.midiHubSnapshot = snap;
        this.pushHud(true);
      },
    });

    soundEngine.setEnsembleMidiEventCallback((role, midi, vel, durMs) => {
      this.midiHub.sendEnsembleRoleEvent(role, midi, vel, durMs);
    });

    // Sympathetic crystal & Drei Star pulse whenever a specific marcher plays its instrument
    soundEngine.setCharacterSingCallback((characterId, hue, role, velocity) => {
      const rig = this.rigs.get(characterId);
      if (rig) {
        const strength = characterId === this.stagedId ? 0.52 * velocity : 0.65 * velocity;
        rig.triggerVfxPulse(hue, strength);
      }
      if (isSingerRole(role)) {
        this.dreiStars.pulseStar(role, 0.72 + velocity * 0.65);
      }
    });

    // Initialize RoomClient BEFORE any spawn or broadcast calls
    this.roomClient = new RoomClient(this.clientId, {
      onStatus: (status) => {
        this.connectionStatus = status;
        if (status === 'reconnecting' && this.characters.size === 0) {
          this.seedFallbackLocalRing();
        }
        this.pushHud(true);
      },
      onMessage: (msg) => this.handleServerMessage(msg),
    });

    this.roomClient.connect();
    this.bindEvents();

    // Auto-boot URL hash song if `#beat=...` is present in location.hash
    if (window.location.hash.startsWith('#beat=')) {
      void decodeBeatFromUrlHash(window.location.hash).then((doc) => {
        if (!this.disposed && doc) {
          this.hasLoadedUrlCartridge = true;
          this.loadBeatDocument(doc);
        }
      });
    }

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.pushHud(true);
    this.startLoop();
  }

  private syncEnsembleToAudio(): void {
    const voices = Array.from(this.characters.values()).map((c) => ({
      id: c.id,
      role: c.role ?? 'melody',
      variant: c.variant ?? getDefaultVariantForRole(c.role ?? 'melody'),
      steps: Array.isArray(c.steps) && c.steps.length === 16 ? c.steps : getDefaultStepsForRole(c.role ?? 'melody'),
      notes: c.notes,
      gain: typeof c.gain === 'number' ? c.gain : 0.82,
      muted: Boolean(c.muted),
      brain: c.brain,
    }));
    soundEngine.setEnsembleVoices(voices);
  }

  private normalizeIncomingCharacter(ch: CharacterState): CharacterState {
    const role: InstrumentRole = ch.role ?? 'melody';
    const variant = ch.variant && isValidVariantForRole(role, ch.variant) ? ch.variant : getDefaultVariantForRole(role);
    const rawSeed = ch.brain?.seed ?? '';
    const isLegacyCode = rawSeed.startsWith('K3:') || /^[A-Z0-9_-]{6,}$/.test(rawSeed);
    const baseBrain = ch.brain?.shapes?.length === 3 ? ch.brain : decodeKolmogorov(getDefaultSeedForRole(role));
    const cleanSeed = isLegacyCode
      ? encodeKolmogorov(baseBrain)
      : rawSeed.trim().toLowerCase().replace(/holonomy/g, 'moss') || encodeKolmogorov(baseBrain);

    return {
      ...ch,
      label: sanitizeFriendlyLabel(ch.label, INSTRUMENT_ROLE_LABELS[role]),
      role,
      variant,
      steps: normalizeSteps16(ch.steps, getDefaultStepsForRole(role)),
      notes: isSingerRole(role) ? normalizeNotes16(ch.notes, role) : undefined,
      gain: typeof ch.gain === 'number' ? ch.gain : 0.82,
      muted: Boolean(ch.muted),
      brain: {
        ...baseBrain,
        seed: cleanSeed,
      },
      mode: 'abandoned',
    };
  }

  private seedFallbackLocalRing(): void {
    const seeded = buildCharactersFromBeatDocument(DEFAULT_BEAT_DOCUMENT, -5000);
    for (const ch of seeded) {
      this.characters.set(ch.id, ch);
      this.ensureRig(ch);
    }
    soundEngine.setBpm(DEFAULT_BEAT_DOCUMENT.bpm);
    soundEngine.setScale(DEFAULT_BEAT_DOCUMENT.scale);
    this.beatTitle = DEFAULT_BEAT_DOCUMENT.title;
    this.syncEnsembleToAudio();
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    dom.addEventListener('wheel', this.handleWheel, { passive: true });
    dom.addEventListener('webglcontextlost', this.handleContextLost);
  }

  private unbindEvents(): void {
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);

    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    dom.removeEventListener('wheel', this.handleWheel);
    dom.removeEventListener('webglcontextlost', this.handleContextLost);
  }

  private handleContextLost = (e: Event): void => {
    e.preventDefault();
  };

  private handleWindowBlur = (): void => {
    if (this.pressedCodes.size > 0) {
      this.pressedCodes.clear();
      this.pushHud(true);
    }
  };

  private handleResize = (): void => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private isInputFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.isInputFocused()) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const code = e.code;

    if (!soundEngine.isInitialized()) {
      void soundEngine.ensureReady();
    }

    if (code === 'Escape') {
      if (this.recordTarget !== null) {
        this.recordTarget = null;
        this.pushHud(true);
        return;
      }
      if (this.stagedId !== null) {
        e.preventDefault();
        this.stageCharacter(null);
      }
      return;
    }

    // All 47 physical ANSI keys are ALWAYS live as polyphonic MIDI input
    if (isAnsi47Code(code)) {
      e.preventDefault();
      if (!e.repeat && !this.pressedCodes.has(code)) {
        const octaveShift = soundEngine.getZynParams().octave;
        const resolved = resolveKey47(this.midiLayout, code, octaveShift);
        if (resolved) {
          this.pressedCodes.add(code);
          this.triggerMidiNote(resolved.midi, 0.85);
        }
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (this.pressedCodes.delete(e.code)) {
      this.pushHud(true);
    }
  };

  private handlePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 2) return;
    this.isPointerDown = true;
    this.pointerDownX = e.clientX;
    this.pointerDownY = e.clientY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    if (!soundEngine.isInitialized()) {
      void soundEngine.ensureReady();
    }
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (this.isPointerDown) {
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;

      this.targetCamYaw -= dx * 0.0065;
      this.targetCamPitch = THREE.MathUtils.clamp(this.targetCamPitch + dy * 0.0055, -0.08, 1.25);
      return;
    }

    if (e.target === this.renderer.domElement) {
      const hovered = this.raycastDancerAt(e.clientX, e.clientY);
      const isHover = hovered !== null;
      if (isHover !== this.hoveringHead) {
        this.hoveringHead = isHover;
        this.renderer.domElement.style.cursor = isHover ? 'pointer' : 'grab';
      }
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (!this.isPointerDown) return;
    this.isPointerDown = false;

    const distMoved = Math.hypot(e.clientX - this.pointerDownX, e.clientY - this.pointerDownY);
    if (distMoved < 6 && e.target === this.renderer.domElement) {
      const charId = this.raycastDancerAt(e.clientX, e.clientY);
      if (charId && this.characters.has(charId)) {
        this.stageCharacter(charId);
      }
    }
  };

  private raycastDancerAt(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hitMeshes: THREE.Object3D[] = [];
    for (const rig of this.rigs.values()) {
      hitMeshes.push(rig.hitMesh);
    }
    const hits = this.raycaster.intersectObjects(hitMeshes, false);
    if (hits.length === 0) return null;
    return (hits[0].object.userData.characterId as string | undefined) ?? null;
  }

  private handleWheel = (e: WheelEvent): void => {
    const minDist = this.stagedId ? 4.8 : 7.5;
    this.targetCamDistance = THREE.MathUtils.clamp(this.targetCamDistance + e.deltaY * 0.008, minDist, 30);
  };

  private getStaged(): CharacterState | null {
    if (!this.stagedId) return null;
    return this.characters.get(this.stagedId) ?? null;
  }

  private ensureRig(ch: CharacterState): CharacterRig {
    let rig = this.rigs.get(ch.id);
    if (!rig) {
      rig = new CharacterRig(ch, this.isSoftwareGl);
      this.rigs.set(ch.id, rig);
      this.scene.add(rig.root);
    }
    return rig;
  }

  private removeCharacterLocal(id: string): void {
    this.characters.delete(id);
    if (this.recordTarget?.id === id) {
      this.recordTarget = null;
    }
    if (this.stagedId === id) {
      this.stagedId = null;
      this.targetCamDistance = 17.8;
      this.targetCamPitch = 0.42;
    }
    const rig = this.rigs.get(id);
    if (rig) {
      this.scene.remove(rig.root);
      rig.dispose();
      this.rigs.delete(id);
    }
    this.syncEnsembleToAudio();
  }

  private replaceAllCharactersLocal(nextChars: CharacterState[]): void {
    for (const id of Array.from(this.characters.keys())) {
      this.removeCharacterLocal(id);
    }
    for (const raw of nextChars) {
      const ch = this.normalizeIncomingCharacter(raw);
      this.characters.set(ch.id, ch);
      const rig = this.ensureRig(ch);
      rig.syncBrain(ch.brain);
      rig.syncRole(ch.role, ch.brain.accentHue);
    }
    this.syncEnsembleToAudio();
  }

  private handleServerMessage(msg: ServerToClientMessage): void {
    if (msg.type === 'snapshot') {
      this.clientCount = msg.snapshot.clientCount;
      // Preserve loaded `#beat=` URL cartridge instead of letting initial default snapshot overwrite it
      if (this.hasLoadedUrlCartridge) {
        this.pushHud(true);
        return;
      }
      if (typeof msg.snapshot.bpm === 'number' && Number.isFinite(msg.snapshot.bpm)) {
        soundEngine.setBpm(msg.snapshot.bpm);
      }
      for (const raw of msg.snapshot.characters) {
        if (raw.id === this.stagedId) continue;
        const ch = this.normalizeIncomingCharacter(raw);
        this.characters.set(ch.id, ch);
        const rig = this.ensureRig(ch);
        rig.syncBrain(ch.brain);
        rig.syncRole(ch.role, ch.brain.accentHue);
      }
      if (this.characters.size === 0) {
        this.seedFallbackLocalRing();
      } else {
        this.syncEnsembleToAudio();
      }
      this.pushHud(true);
      return;
    }

    if (msg.type === 'room:presence') {
      this.clientCount = msg.clientCount;
      this.pushHud(true);
      return;
    }

    if (msg.type === 'room:bpm') {
      soundEngine.setBpm(msg.bpm);
      this.pushHud(true);
      return;
    }

    if (msg.type === 'room:beat_loaded') {
      soundEngine.setBpm(msg.bpm);
      this.replaceAllCharactersLocal(msg.characters);
      this.pushHud(true);
      return;
    }

    if (msg.type === 'character:spawned') {
      if (!this.characters.has(msg.character.id)) {
        const ch = this.normalizeIncomingCharacter(msg.character);
        this.characters.set(ch.id, ch);
        this.ensureRig(ch);
        this.syncEnsembleToAudio();
      }
      this.pushHud(true);
      return;
    }

    if (msg.type === 'character:updated') {
      const existing = this.characters.get(msg.id);
      if (!existing) return;
      if (msg.bootAt !== undefined) existing.bootAt = msg.bootAt;
      if (msg.role !== undefined) existing.role = msg.role;
      if (msg.variant !== undefined) existing.variant = msg.variant;
      if (msg.steps !== undefined) existing.steps = msg.steps;
      if (msg.notes !== undefined) existing.notes = msg.notes;
      if (msg.gain !== undefined) existing.gain = msg.gain;
      if (msg.muted !== undefined) existing.muted = msg.muted;
      if (msg.brain !== undefined) {
        existing.brain = msg.brain;
        this.rigs.get(msg.id)?.syncBrain(msg.brain);
      }
      if (msg.role !== undefined) {
        this.rigs.get(msg.id)?.syncRole(existing.role, existing.brain.accentHue);
      }
      this.syncEnsembleToAudio();
      this.pushHud(true);
      return;
    }

    if (msg.type === 'character:abandoned') {
      const existing = this.characters.get(msg.id);
      if (!existing || msg.id === this.stagedId) return;
      existing.ownerId = null;
      existing.mode = 'abandoned';
      existing.orbitRadius = msg.orbitRadius;
      existing.orbitAngle = msg.orbitAngle;
      existing.orbitSpeed = msg.orbitSpeed;
      existing.orbitDir = msg.orbitDir;
      this.pushHud(true);
      return;
    }

    if (msg.type === 'character:removed') {
      this.removeCharacterLocal(msg.id);
      this.pushHud(true);
      return;
    }

    if (msg.type === 'room:cleared_abandoned') {
      for (const id of Array.from(this.characters.keys())) {
        if (id !== this.stagedId) {
          this.removeCharacterLocal(id);
        }
      }
      this.pushHud(true);
    }
  }

  // ==================== PUBLIC BEAT, BPM & INSTRUMENT ACTIONS ====================

  public setBpm(bpm: number): number {
    const applied = soundEngine.setBpm(bpm);
    this.roomClient.send({ type: 'set_bpm', bpm: applied });
    this.pushHud(true);
    return applied;
  }

  public setBeatScale(scale: MusicalScaleId): void {
    soundEngine.setScale(scale);
    this.pushHud(true);
  }

  public getBeatDocument(): BeatDocument {
    return exportBeatDocumentFromCharacters(
      this.characters.values(),
      soundEngine.getBpm(),
      soundEngine.getScale(),
      this.beatTitle
    );
  }

  public loadBeatDocument(doc: BeatDocument): BeatDocument {
    soundEngine.setBpm(doc.bpm);
    soundEngine.setScale(doc.scale);
    this.beatTitle = doc.title;

    const nextChars = buildCharactersFromBeatDocument(doc, 0);
    this.replaceAllCharactersLocal(nextChars);
    this.roomClient.send({ type: 'load_beat', beat: doc, characters: nextChars });
    void soundEngine.playBootupChime(this.spawnCounter++);
    this.dreiStars.pulseStar('bass', 1.35);
    this.dreiStars.pulseStar('melody', 1.35);
    this.dreiStars.pulseStar('harmony', 1.35);
    this.pushHud(true);
    return this.getBeatDocument();
  }

  // ==================== SHAREABLE URL CARTRIDGE, WEBMIDI & STUDIO CAPTURE ====================

  public async createShareCartridgeUrl(): Promise<EncodedCartridge> {
    const doc = this.getBeatDocument();
    const encoded = await encodeBeatToUrlCartridge(doc);
    try {
      window.history.replaceState(null, '', encoded.hash);
    } catch {
      // Ignore iframe history restrictions
    }
    return encoded;
  }

  private handleMidiControlChange(cc: number, norm: number): void {
    if (cc === 74) {
      // Filter Cutoff
      soundEngine.setZynParams({ cutoff: Math.round(320 + norm * 6080) });
    } else if (cc === 71) {
      // Filter Resonance
      soundEngine.setZynParams({ resonance: Number((0.5 + norm * 9.0).toFixed(1)) });
    } else if (cc === 72) {
      // Envelope Release
      soundEngine.setZynParams({ release: Number((0.14 + norm * 1.86).toFixed(2)) });
    } else if (cc === 1) {
      const staged = this.getStaged();
      if (staged) {
        this.updateStagedBrain({ ...staged.brain, complexity: Number(norm.toFixed(2)) }, false);
      }
    }
  }

  public async reconnectWebMidi(): Promise<MidiHubSnapshot> {
    const snap = await this.midiHub.connect({
      onNoteOn: (midi, velocity) => this.triggerMidiNote(midi, velocity),
      onControlChange: (cc, norm) => this.handleMidiControlChange(cc, norm),
      onStatusChange: (next) => {
        this.midiHubSnapshot = next;
        this.pushHud(true);
      },
    });
    this.midiHubSnapshot = snap;
    this.pushHud(true);
    return snap;
  }

  public setMidiOutputPort(portId: string | null): void {
    this.midiHub.setOutputPort(portId);
  }

  public setMidiOutEnabled(enabled: boolean): void {
    this.midiHub.setMidiOutEnabled(enabled);
  }

  public async toggleVideoRecording(): Promise<StudioRecorderState> {
    if (this.studioRecorder.getState().isRecording) {
      this.studioRecorder.stop();
      this.pushHud(true);
      return this.studioRecorder.getState();
    }

    await soundEngine.ensureReady();
    const audioStream = soundEngine.getMasterAudioStream();
    this.studioRecorder.start(
      this.renderer.domElement,
      audioStream,
      this.beatTitle,
      soundEngine.getBpm(),
      () => {
        this.pushHud(true);
      }
    );
    this.pushHud(true);
    return this.studioRecorder.getState();
  }

  public exportMidiFile(): string {
    return downloadMidiFromBeat(this.getBeatDocument());
  }

  public spawnMarcher(role: InstrumentRole = 'melody', variant?: string): CharacterState {
    const resolvedVariant =
      variant && isValidVariantForRole(role, variant) ? variant : getDefaultVariantForRole(role);
    const seed = getDefaultSeedForRole(role);
    const steps = getDefaultStepsForRole(role);
    const notes = getDefaultNotesForRole(role);
    const brain = buildBrainFromBeatMarcher({
      id: 'temp',
      label: 'temp',
      role,
      variant: resolvedVariant,
      muted: false,
      gain: 0.84,
      steps,
      notes,
      seed,
    });
    const baseName = INSTRUMENT_ROLE_LABELS[role];
    const sameRoleCount = Array.from(this.characters.values()).filter((c) => c.role === role).length;
    const label = sameRoleCount === 0 ? baseName : `${baseName} ${sameRoleCount + 1}`;
    const ch = createSpawnCharacter(this.clientId, brain, {
      role,
      variant: resolvedVariant,
      steps,
      notes,
      gain: 0.84,
      muted: false,
      label,
    });

    this.characters.set(ch.id, ch);
    this.ensureRig(ch);
    this.syncEnsembleToAudio();
    this.spawnCounter++;

    this.roomClient.send({ type: 'spawn', character: ch });
    void soundEngine.playBootupChime(this.spawnCounter);
    this.spawnSparkBurst(ch.x, ch.y + 2.2, ch.z, ch.brain.accentHue, 10);
    this.pushHud(true);
    return ch;
  }

  public upsertMarcherFromSpec(spec: Partial<BeatMarcherSpec> & { role: InstrumentRole }): BeatMarcherSpec {
    const role = spec.role;
    const existing = spec.id ? this.characters.get(spec.id) : undefined;
    const variant =
      spec.variant && isValidVariantForRole(role, spec.variant)
        ? spec.variant
        : existing?.role === role
          ? existing.variant
          : getDefaultVariantForRole(role);
    const steps = spec.steps
      ? normalizeSteps16(spec.steps, getDefaultStepsForRole(role))
      : existing?.steps ?? getDefaultStepsForRole(role);
    const notes = isSingerRole(role)
      ? spec.notes
        ? normalizeNotes16(spec.notes, role)
        : existing?.notes ?? getDefaultNotesForRole(role)
      : undefined;
    const gain = typeof spec.gain === 'number' ? Math.max(0.1, Math.min(1.2, spec.gain)) : existing?.gain ?? 0.84;
    const muted = spec.muted !== undefined ? Boolean(spec.muted) : existing?.muted ?? false;
    const seed =
      spec.seed && spec.seed.trim()
        ? spec.seed.trim().toLowerCase()
        : existing?.brain.seed ?? getDefaultSeedForRole(role);
    const label = sanitizeFriendlyLabel(spec.label, existing?.label ?? INSTRUMENT_ROLE_LABELS[role]);

    const fullSpec: BeatMarcherSpec = {
      id: existing?.id ?? spec.id ?? `marcher-${role}-${Date.now().toString(36).slice(-4)}`,
      label,
      role,
      variant,
      muted,
      gain,
      steps,
      ...(notes ? { notes } : {}),
      seed,
      visuals: spec.visuals,
    };

    const brain = buildBrainFromBeatMarcher(fullSpec);

    if (existing) {
      existing.label = fullSpec.label;
      existing.role = fullSpec.role;
      existing.variant = fullSpec.variant;
      existing.steps = [...fullSpec.steps];
      existing.notes = fullSpec.notes ? [...fullSpec.notes] : undefined;
      existing.gain = fullSpec.gain;
      existing.muted = fullSpec.muted;
      existing.brain = brain;
      existing.bootAt = Date.now();
      const rig = this.rigs.get(existing.id);
      rig?.syncBrain(brain);
      rig?.syncRole(existing.role, brain.accentHue);
      this.syncEnsembleToAudio();
      this.broadcastCharacterUpdate(existing, true, true);
      void soundEngine.playBootupChime(this.spawnCounter++);
      this.pushHud(true);
      return fullSpec;
    }

    const created = createSpawnCharacter(this.clientId, brain, {
      id: fullSpec.id,
      label: fullSpec.label,
      role: fullSpec.role,
      variant: fullSpec.variant,
      steps: fullSpec.steps,
      notes: fullSpec.notes,
      gain: fullSpec.gain,
      muted: fullSpec.muted,
    });
    this.characters.set(created.id, created);
    this.ensureRig(created);
    this.syncEnsembleToAudio();
    this.roomClient.send({ type: 'spawn', character: created });
    void soundEngine.playBootupChime(this.spawnCounter++);
    this.pushHud(true);
    return fullSpec;
  }

  public removeMarcherById(id: string): boolean {
    if (!this.characters.has(id)) return false;
    this.removeCharacterLocal(id);
    this.roomClient.send({ type: 'remove', id });
    this.pushHud(true);
    return true;
  }

  public setRecordTarget(target: RecordStepTarget | null): void {
    this.recordTarget = target;
    this.pushHud(true);
  }

  public updateMarcherInstrument(
    id: string,
    patch: Partial<{
      role: InstrumentRole;
      variant: string;
      steps: number[];
      notes: Array<number | null> | undefined;
      gain: number;
      muted: boolean;
    }>
  ): void {
    const target = this.characters.get(id);
    if (!target) return;

    if (patch.role !== undefined && patch.role !== target.role) {
      target.role = patch.role;
      target.variant =
        patch.variant && isValidVariantForRole(patch.role, patch.variant)
          ? patch.variant
          : getDefaultVariantForRole(patch.role);
      if (isSingerRole(patch.role)) {
        target.notes = target.notes ?? getDefaultNotesForRole(patch.role);
        target.brain = { ...target.brain, accentHue: DREI_STAR_HUES[patch.role] };
      } else {
        target.notes = undefined;
      }
      target.orbitRadius = isSingerRole(patch.role) ? 9.15 : 7.5;
      this.rigs.get(target.id)?.syncBrain(target.brain);
      this.rigs.get(target.id)?.syncRole(target.role, target.brain.accentHue);
    } else if (patch.variant !== undefined && isValidVariantForRole(target.role, patch.variant)) {
      target.variant = patch.variant;
    }

    if (patch.steps !== undefined) {
      target.steps = normalizeSteps16(patch.steps, target.steps);
    }
    if ('notes' in patch) {
      target.notes = isSingerRole(target.role) ? normalizeNotes16(patch.notes, target.role) : undefined;
    }
    if (patch.gain !== undefined) {
      target.gain = Math.max(0.1, Math.min(1.2, patch.gain));
    }
    if (patch.muted !== undefined) {
      target.muted = Boolean(patch.muted);
    }

    this.syncEnsembleToAudio();
    this.broadcastCharacterUpdate(target, false, true);
    this.pushHud(true);
  }

  public setMarcherStep(id: string, stepIdx: number, forceActive?: boolean): void {
    const target = this.characters.get(id);
    if (!target || stepIdx < 0 || stepIdx >= 16) return;
    if (!soundEngine.isInitialized()) {
      void soundEngine.ensureReady();
    }

    const nextSteps = [...target.steps];
    const currentlyOn = nextSteps[stepIdx] > 0.05;
    const nextOn = forceActive !== undefined ? forceActive : !currentlyOn;
    if (nextOn === currentlyOn) return;

    nextSteps[stepIdx] = nextOn ? (stepIdx % 4 === 0 ? 0.95 : 0.78) : 0;

    let nextNotes: Array<number | null> | undefined = isSingerRole(target.role)
      ? [...(target.notes ?? getDefaultNotesForRole(target.role)!)]
      : undefined;

    if (nextNotes && nextOn && nextNotes[stepIdx] === null) {
      const spec = SCALE_INTERVALS[soundEngine.getScale()] ?? SCALE_INTERVALS['D-lydian'];
      const octOffset = target.role === 'bass' ? -12 : target.role === 'melody' ? 12 : 0;
      nextNotes[stepIdx] = spec.rootMidi + octOffset + spec.intervals[stepIdx % spec.intervals.length];
    }

    const hue = isSingerRole(target.role) ? DREI_STAR_HUES[target.role] : target.brain.accentHue;
    this.rigs.get(target.id)?.triggerVfxPulse(hue, nextOn ? 0.65 : 0.25);
    this.updateMarcherInstrument(target.id, { steps: nextSteps, notes: nextNotes });
  }

  public nudgeMarcherStepNote(id: string, stepIdx: number, deltaDegree: number): void {
    const target = this.characters.get(id);
    if (!target || !isSingerRole(target.role) || stepIdx < 0 || stepIdx >= 16) return;
    if (!soundEngine.isInitialized()) {
      void soundEngine.ensureReady();
    }

    const spec = SCALE_INTERVALS[soundEngine.getScale()] ?? SCALE_INTERVALS['D-lydian'];
    const intervals = spec.intervals;
    const octOffset = target.role === 'bass' ? -12 : target.role === 'melody' ? 12 : 0;
    const fallbackMidi = spec.rootMidi + octOffset + intervals[stepIdx % intervals.length];

    const nextSteps = [...target.steps];
    if (nextSteps[stepIdx] <= 0.05) {
      nextSteps[stepIdx] = stepIdx % 4 === 0 ? 0.95 : 0.78;
    }

    const nextNotes = [...(target.notes ?? getDefaultNotesForRole(target.role)!)];
    const curMidi = typeof nextNotes[stepIdx] === 'number' ? nextNotes[stepIdx]! : fallbackMidi;

    const rootPc = spec.rootMidi % 12;
    const rel = curMidi - rootPc;
    const oct = Math.floor(rel / 12);
    const pc = ((rel % 12) + 12) % 12;

    let bestIdx = 0;
    let bestDist = 99;
    for (let i = 0; i < intervals.length; i++) {
      const d = Math.abs(intervals[i] - pc);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    const totalDeg = bestIdx + deltaDegree;
    const octDelta = Math.floor(totalDeg / intervals.length);
    const nextIdx = ((totalDeg % intervals.length) + intervals.length) % intervals.length;
    const nextMidi = Math.max(24, Math.min(96, rootPc + (oct + octDelta) * 12 + intervals[nextIdx]));

    nextNotes[stepIdx] = nextMidi;
    soundEngine.playZynNote(nextMidi, 0.52, true);
    this.rigs.get(target.id)?.triggerVfxPulse(DREI_STAR_HUES[target.role], 0.75);
    this.updateMarcherInstrument(target.id, { steps: nextSteps, notes: nextNotes });
  }

  public clearAllSteps(): void {
    const empty = new Array<number>(16).fill(0);
    for (const ch of this.characters.values()) {
      ch.steps = [...empty];
      this.broadcastCharacterUpdate(ch, false, false);
    }
    this.syncEnsembleToAudio();
    this.pushHud(true);
  }

  public setMidiLayout(layout: Midi47LayoutId): void {
    this.midiLayout = layout;
    this.pushHud(true);
  }

  /**
   * Click any Crystal Fae's head -> walks gracefully up beside the central campfire,
   * turns to face the camera, and expands its Clear Cube head HUGE (3.35x) illuminated by the hearth.
   */
  public stageCharacter(id: string | null): void {
    const resolvedId = id && this.characters.has(id) ? id : null;
    const prevId = this.stagedId;

    if (prevId && prevId !== resolvedId) {
      const prev = this.characters.get(prevId);
      if (prev) {
        prev.mode = 'abandoned';
        prev.moving = true;
      }
    }

    this.stagedId = resolvedId;

    if (resolvedId) {
      const stageRadius = 2.45;
      this.stageSpotX = Math.sin(this.targetCamYaw) * stageRadius;
      this.stageSpotZ = Math.cos(this.targetCamYaw) * stageRadius;

      const ch = this.characters.get(resolvedId);
      const rig = this.rigs.get(resolvedId);
      if (ch && rig) {
        rig.triggerVfxPulse(ch.brain.accentHue, 1.05);
        this.spawnSparkBurst(ch.x, ch.y + 2.4, ch.z, ch.brain.accentHue, 10);
      }
      this.targetCamDistance = 8.4;
      this.targetCamPitch = 0.12;
      void soundEngine.playAbandonChime();
    } else {
      this.targetCamDistance = 17.8;
      this.targetCamPitch = 0.42;
    }

    this.pushHud(true);
  }

  public stageNextDancer(): void {
    const ids = Array.from(this.characters.keys());
    if (ids.length === 0) {
      this.spawnMarcher('melody');
      return;
    }
    if (!this.stagedId) {
      this.stageCharacter(ids[0]);
      return;
    }
    const idx = ids.indexOf(this.stagedId);
    const nextId = ids[(idx + 1) % ids.length];
    this.stageCharacter(nextId);
  }

  public triggerKey47FromPointer(code: string, midi: number): void {
    this.pressedCodes.add(code);
    this.triggerMidiNote(midi, 0.85);
    window.setTimeout(() => {
      if (this.pressedCodes.delete(code)) {
        this.pushHud(true);
      }
    }, 160);
  }

  public triggerMidiNote(midi: number, velocity = 0.85): MidiNoteResult {
    const res = soundEngine.playZynNote(midi, velocity, true);
    this.lastMidiNote = res.noteName;

    // If a singer cell is armed for step-note entry, write this played MIDI note straight into that row!
    if (this.recordTarget !== null) {
      const recChar = this.characters.get(this.recordTarget.id);
      if (recChar && isSingerRole(recChar.role)) {
        const sIdx = this.recordTarget.stepIdx;
        const nextSteps = [...recChar.steps];
        const nextNotes = [...(recChar.notes ?? getDefaultNotesForRole(recChar.role)!)];
        nextSteps[sIdx] = Number(Math.max(0.65, Math.min(1, velocity)).toFixed(2));
        nextNotes[sIdx] = res.midi;
        this.recordTarget = { id: recChar.id, stepIdx: (sIdx + 1) % 16 };
        this.updateMarcherInstrument(recChar.id, { steps: nextSteps, notes: nextNotes });
      }
    }

    const staged = this.getStaged();
    if (staged) {

      if (isSingerRole(staged.role)) {
        this.dreiStars.pulseStar(staged.role, 1.15);
      }

      const mode = staged.brain.vfxTriggerMode ?? 'on-beat';
      const rig = this.rigs.get(staged.id);
      const headY = rig ? rig.getHeadWorldY() : staged.y + 3.6;
      if (mode === 'single') {
        rig?.triggerVfxPulse(res.hue, 1.3);
        this.spawnSparkBurst(staged.x, headY, staged.z, res.hue, 12);
      } else {
        rig?.triggerVfxPulse(res.hue, 0.58);
        this.queuedMidiVfx.push({ targetId: staged.id, hue: res.hue, strength: 1.35 });
      }
    } else {
      for (const ch of this.characters.values()) {
        this.rigs.get(ch.id)?.triggerVfxPulse(res.hue, 0.78);
      }
      this.dreiStars.pulseStar('melody', 0.9);
    }

    this.pushHud(true);
    return res;
  }

  public updateStagedBrain(nextBrain: KolmogorovBrain, replayBoot = false): void {
    let target = this.getStaged();
    if (!target) {
      const first = this.characters.values().next().value as CharacterState | undefined;
      if (first) {
        this.stageCharacter(first.id);
        target = first;
      } else {
        target = this.spawnMarcher('melody');
      }
    }
    if (!target) return;

    target.brain = nextBrain;
    if (replayBoot) {
      target.bootAt = Date.now();
      void soundEngine.playBootupChime(this.spawnCounter++);
    }
    this.rigs.get(target.id)?.syncBrain(nextBrain);
    this.syncEnsembleToAudio();
    this.broadcastCharacterUpdate(target, replayBoot, true);
    this.pushHud(true);
  }

  public triggerBootSequence(): void {
    const target = this.getStaged();
    if (target) {
      target.bootAt = Date.now();
      void soundEngine.playBootupChime(this.spawnCounter++);
      this.broadcastCharacterUpdate(target, true, false);
    } else {
      const now = Date.now();
      for (const ch of this.characters.values()) {
        ch.bootAt = now;
      }
      void soundEngine.playBootupChime(this.spawnCounter++);
    }
    this.pushHud(true);
  }

  public clearRing(): void {
    for (const id of Array.from(this.characters.keys())) {
      if (id !== this.stagedId) {
        this.removeCharacterLocal(id);
      }
    }
    this.roomClient.send({ type: 'clear_abandoned' });
    this.pushHud(true);
  }

  public setCameraPreset(preset: 'stage' | 'overview'): void {
    if (preset === 'stage') {
      if (!this.stagedId) {
        this.stageNextDancer();
      } else {
        this.targetCamDistance = 8.4;
        this.targetCamPitch = 0.12;
      }
    } else {
      this.stageCharacter(null);
      this.targetCamDistance = 21.0;
      this.targetCamPitch = 0.62;
    }
  }

  // ==================== SIMULATION & RENDER LOOP ====================

  private broadcastCharacterUpdate(
    ch: CharacterState,
    includeBoot = false,
    includeBrain = false
  ): void {
    this.roomClient.send({
      type: 'update',
      id: ch.id,
      x: Number(ch.x.toFixed(3)),
      y: Number(ch.y.toFixed(3)),
      z: Number(ch.z.toFixed(3)),
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: Number(ch.yaw.toFixed(3)),
      mode: ch.mode,
      moving: ch.moving,
      bootAt: includeBoot ? ch.bootAt : undefined,
      brain: includeBrain ? ch.brain : undefined,
      role: ch.role,
      variant: ch.variant,
      steps: ch.steps,
      notes: ch.notes,
      gain: ch.gain,
      muted: ch.muted,
    });
  }

  private spawnSparkBurst(x: number, y: number, z: number, hue: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL((((hue % 360) + 360) % 360) / 360, 0.92, 0.64),
        transparent: true,
        opacity: 0.92,
      });
      const m = new THREE.Mesh(this.sparkGeo, mat);
      m.position.set(x, y, z);
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const spd = 2.0 + Math.random() * 3.2;
      this.scene.add(m);
      this.sparkParticles.push({
        mesh: m,
        mat,
        vx: Math.cos(ang) * spd,
        vy: 1.8 + Math.random() * 2.8,
        vz: Math.sin(ang) * spd,
        life: 0.78 + Math.random() * 0.25,
        gravity: 5.2,
      });
    }
  }

  /**
   * Walks the staged Crystal Fae cleanly around/to the hearthside spot (never stepping inside the flames)
   */
  private stepStagedCharacter(ch: CharacterState, dt: number): boolean {
    const dx = this.stageSpotX - ch.x;
    const dz = this.stageSpotZ - ch.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.14) {
      const speed = Math.min(dist / Math.max(dt, 0.016), 6.6);
      let nx = dx / dist;
      let nz = dz / dist;

      // Gentle radial avoidance around the central campfire stone ring (radius 1.7)
      const fireDist = Math.hypot(ch.x, ch.z);
      if (fireDist < 1.85 && fireDist > 0.01) {
        const push = (1.85 - fireDist) * 1.4;
        nx += (ch.x / fireDist) * push;
        nz += (ch.z / fireDist) * push;
        const nMag = Math.hypot(nx, nz) || 1;
        nx /= nMag;
        nz /= nMag;
      }

      ch.x += nx * speed * dt;
      ch.z += nz * speed * dt;
      ch.y = THREE.MathUtils.damp(ch.y, 0, 6, dt);

      const walkYaw = Math.atan2(nx, nz);
      let diff = walkYaw - ch.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      ch.yaw += diff * Math.min(1, dt * 10);
      ch.moving = true;
      return dist < 1.85;
    }

    ch.x = THREE.MathUtils.damp(ch.x, this.stageSpotX, 12, dt);
    ch.z = THREE.MathUtils.damp(ch.z, this.stageSpotZ, 12, dt);
    ch.y = THREE.MathUtils.damp(ch.y, 0, 8, dt);
    ch.moving = false;

    const faceCamYaw = this.camYaw;
    let diff = faceCamYaw - ch.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    ch.yaw += diff * Math.min(1, dt * 7);
    return true;
  }

  private stepRingDancer(
    ch: CharacterState,
    dt: number,
    audio: AudioBands,
    clock: MusicalClock
  ): void {
    if (clock.isBreakBar) {
      const faceCenterYaw = Math.atan2(-ch.x, -ch.z);
      let diff = faceCenterYaw - ch.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      ch.yaw += diff * Math.min(1, dt * 9);
      ch.y = THREE.MathUtils.damp(ch.y, 0, 6, dt);
      ch.moving = false;
      return;
    }

    // Scale ring marching velocity proportionally to BPM so spatial stride matches STEP/step footwork!
    const bpmScale = clock.bpm / 102;
    const stepSurge = clock.halfBeatIndex % 2 === 0 ? 1.12 : 0.88;
    const musicBoost = bpmScale * stepSurge * (1 + audio.beatPulse * 0.22);
    const dAngle = ch.orbitSpeed * ch.orbitDir * musicBoost * dt;
    ch.orbitAngle += dAngle;

    const targetX = Math.cos(ch.orbitAngle) * ch.orbitRadius;
    const targetZ = Math.sin(ch.orbitAngle) * ch.orbitRadius;

    ch.x = THREE.MathUtils.damp(ch.x, targetX, 3.2, dt);
    ch.z = THREE.MathUtils.damp(ch.z, targetZ, 3.2, dt);
    ch.y = THREE.MathUtils.damp(ch.y, 0, 4.0, dt);

    const tangentX = -Math.sin(ch.orbitAngle) * ch.orbitDir;
    const tangentZ = Math.cos(ch.orbitAngle) * ch.orbitDir;
    const targetYaw = Math.atan2(tangentX, tangentZ);
    let diff = targetYaw - ch.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    ch.yaw += diff * Math.min(1, dt * 7);
    ch.moving = true;
  }

  private updateCamera(dt: number): void {
    this.camYaw = THREE.MathUtils.damp(this.camYaw, this.targetCamYaw, 8.5, dt);
    this.camPitch = THREE.MathUtils.damp(this.camPitch, this.targetCamPitch, 8.5, dt);
    this.camDistance = THREE.MathUtils.damp(this.camDistance, this.targetCamDistance, 8.5, dt);

    const staged = this.getStaged();
    if (staged) {
      this._desiredLook.set(staged.x, 2.55, staged.z);
    } else {
      this._desiredLook.set(0, 1.85, 0);
    }

    this.camLookTarget.lerp(this._desiredLook, 1 - Math.exp(-7.0 * dt));

    const horizDist = Math.cos(this.camPitch) * this.camDistance;
    const vertDist = Math.sin(this.camPitch) * this.camDistance;
    this._desiredCamPos.set(
      this.camLookTarget.x + Math.sin(this.camYaw) * horizDist,
      this.camLookTarget.y + vertDist + (staged ? 0.55 : 1.1),
      this.camLookTarget.z + Math.cos(this.camYaw) * horizDist
    );

    this.camera.position.lerp(this._desiredCamPos, 1 - Math.exp(-8.0 * dt));
    this.camera.lookAt(this.camLookTarget);
  }

  private updateSparkParticles(dt: number): void {
    for (let i = this.sparkParticles.length - 1; i >= 0; i--) {
      const p = this.sparkParticles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mat.dispose();
        this.sparkParticles.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += dt * 7;
      p.mesh.rotation.y += dt * 6;
      const sc = Math.max(0.01, Math.min(1, p.life * 1.1));
      p.mesh.scale.setScalar(sc);
      p.mat.opacity = sc * 0.9;
    }
  }

  private pushHud(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastHudPushMs < 90) return;
    this.lastHudPushMs = now;

    const elapsedSec = (now - this.startTimeMs) / 1000;
    const staged = this.getStaged();
    const first = this.characters.values().next().value as CharacterState | undefined;
    const activeChar = staged ?? first ?? null;
    const displayBrain = activeChar?.brain ?? decodeKolmogorov('sunny-moss');

    const marchers: MarcherSummary[] = Array.from(this.characters.values()).map((c) => ({
      id: c.id,
      label: c.label,
      role: c.role,
      variant: c.variant,
      muted: c.muted,
      gain: c.gain,
      accentHue: isSingerRole(c.role) ? DREI_STAR_HUES[c.role] : c.brain.accentHue,
      steps: [...c.steps],
      notes: c.notes ? [...c.notes] : undefined,
    }));

    const clock = soundEngine.getMusicalClock(now);

    this.onHudUpdate({
      connectionStatus: this.connectionStatus,
      clientCount: this.clientCount,
      dancerCount: this.characters.size,
      stagedId: staged?.id ?? null,
      stagedLabel: staged?.label ?? null,
      stagedCharacter: activeChar
        ? {
            ...activeChar,
            steps: [...activeChar.steps],
            notes: activeChar.notes ? [...activeChar.notes] : undefined,
          }
        : null,
      stagedBrain: displayBrain,
      marchers,
      beatTitle: this.beatTitle,
      beatScale: soundEngine.getScale(),
      audioBands: soundEngine.getAudioBands(elapsedSec),
      musicalClock: clock,
      midiLayout: this.midiLayout,
      activeKeyCodes: Array.from(this.pressedCodes),
      lastMidiNote: this.lastMidiNote,
      recordTarget: this.recordTarget,
      midiHub: this.midiHubSnapshot,
      recorder: this.studioRecorder.getState(),
    });
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext | null;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        gl.deleteSync(sync);
        return;
      }
      const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private startLoop(): void {
    const tick = () => {
      if (this.disposed) return;
      const nowPerf = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (nowPerf - this.lastTimeMs) / 1000));
      this.lastTimeMs = nowPerf;

      const elapsedSec = (nowPerf - this.startTimeMs) / 1000;
      const nowMs = Date.now();
      const audio = soundEngine.getAudioBands(elapsedSec);
      const clock = soundEngine.getMusicalClock(nowPerf);

      // Update central musical campfire in exact sync with the 8-beat bump/BUMP/FOOOF! rhythm
      this.campfire.update(elapsedSec, dt, audio, clock);

      // Update Drei Stars tri-star harmonic constellation hovering above the hearth
      this.dreiStars.update(elapsedSec, dt, audio, clock);

      // Update ambient Fae Forest fireflies & breathing quartz crystals
      this.world.updateAmbient(dt, elapsedSec, audio.beatPulse);

      // 8-Bar Dance Break entry & Bar-1 Reversal
      if (clock.isBreakBar && !this.wasBreakBar) {
        soundEngine.playBreakSwell();
      }
      this.wasBreakBar = clock.isBreakBar;

      if (clock.phraseIndex !== this.lastPhraseIndex) {
        this.lastPhraseIndex = clock.phraseIndex;
        for (const ch of this.characters.values()) {
          if (ch.id !== this.stagedId) {
            ch.orbitDir = ch.orbitDir === 1 ? -1 : 1;
          }
        }
      }

      // Fire any queued On-Beat MIDI VFX bursts right on the musical beat
      if (clock.justHitBeat && this.queuedMidiVfx.length > 0) {
        const queued = this.queuedMidiVfx.splice(0, this.queuedMidiVfx.length);
        for (const item of queued) {
          if (item.targetId) {
            const ch = this.characters.get(item.targetId);
            const rig = this.rigs.get(item.targetId);
            if (ch && rig) {
              rig.triggerVfxPulse(item.hue, item.strength);
              this.spawnSparkBurst(ch.x, rig.getHeadWorldY(), ch.z, item.hue, 12);
            }
          }
        }
      }

      for (const ch of this.characters.values()) {
        const isCenterStage = ch.id === this.stagedId;
        let atCenterStage = false;
        if (isCenterStage) {
          atCenterStage = this.stepStagedCharacter(ch, dt);
        } else {
          this.stepRingDancer(ch, dt, audio, clock);
        }
        const rig = this.ensureRig(ch);
        rig.update(
          ch,
          isCenterStage,
          atCenterStage,
          elapsedSec,
          nowMs,
          audio,
          clock,
          dt
        );
      }

      this.updateSparkParticles(dt);
      this.updateCamera(dt);
      this.renderer.render(this.scene, this.camera);
      this.pushHud(false);

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.frameId = window.setTimeout(tick, 16);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.frameId);
    this.unbindEvents();
    this.midiHub.dispose();
    this.studioRecorder.dispose();
    soundEngine.setCharacterSingCallback(null);
    soundEngine.setEnsembleMidiEventCallback(null);
    this.roomClient.close();

    for (const rig of this.rigs.values()) {
      this.scene.remove(rig.root);
      rig.dispose();
    }
    this.rigs.clear();

    for (const p of this.sparkParticles) {
      this.scene.remove(p.mesh);
      p.mat.dispose();
    }
    this.sparkParticles = [];
    this.sparkGeo.dispose();

    this.scene.remove(this.campfire.root);
    this.campfire.dispose();

    this.scene.remove(this.dreiStars.root);
    this.dreiStars.dispose();

    for (const d of this.world.disposables) {
      d.dispose();
    }
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
