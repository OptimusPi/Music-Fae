import {
  DEFAULT_BPM,
  InstrumentRole,
  MAX_BPM,
  MIN_BPM,
  MusicalScaleId,
  SCALE_INTERVALS,
  bpmToAnimFps,
  isSingerRole,
} from '../shared/beatSchema';
import { KolmogorovBrain } from '../shared/protocol';

/**
 * Tasteful Lo-Fi Bit-Crushed Console + ZynAddSubFX-Inspired Polyphonic Sound Engine
 * Aesthetic: Hans Zimmer warm brass/sub harmonic blooms + Tycho analog tape chords
 * + 7-Role Crystal Fae Marching Ensemble (4 Drums + 3 Drei Stars Singers)
 * + Exact sample-tight 8-beat campfire sync (bump..bump..bump..BUMP..bump..bump..bump..FOOOF!)
 * + Manual BPM control (drives both tempo and 0.2*bpm walking FPS) + Live Mic BPM detection.
 */

export interface AudioBands {
  bass: number; // 0..1
  mid: number; // 0..1
  treble: number; // 0..1
  overall: number; // 0..1
  beatPulse: number; // 0..1
}

export type AudioSourceMode = 'synth' | 'mic' | 'muted';

export type ZynPatchId = 'pad-glass' | 'ad-brass' | 'sub-pluck' | 'fm-bell' | 'lofi-acid';

export interface ZynSynthParams {
  patch: ZynPatchId;
  cutoff: number; // 300..6500 Hz
  resonance: number; // 0.5..10
  detune: number; // 0..28 cents
  release: number; // 0.12..2.2 sec
  octave: number; // -1, 0, 1
}

export const ZYN_PATCH_LABELS: Record<ZynPatchId, string> = {
  'pad-glass': 'Glass Pad',
  'ad-brass': 'Warm Brass',
  'sub-pluck': 'Soft Pluck',
  'fm-bell': 'Chime Bell',
  'lofi-acid': 'Warm Bass',
};

export type DanceBreakStyle = 'wave' | 'mega-twirl' | 'moon-spin' | 'head-pop';

export const DANCE_BREAK_LABELS: Record<DanceBreakStyle, string> = {
  wave: 'The Wave',
  'mega-twirl': 'Jump & Twirl',
  'moon-spin': 'Reverse Spin',
  'head-pop': 'Cube Pop',
};

const BREAK_ROTATION: DanceBreakStyle[] = ['wave', 'mega-twirl', 'moon-spin', 'head-pop'];

export interface MusicalClock {
  bpm: number;
  animFps: number; // BPM-coupled PSX frame rate = 0.2 * bpm (24 FPS at 120 BPM, 12 frames per beat)
  exactBeats: number; // continuous phase accumulator for zero-drift animation
  barInPhrase: number; // 1..8
  beatInBar: number; // 1..4
  step16: number; // 0..15 sixteenth-note step within current 4/4 bar
  halfBeatIndex: number; // 0..7 half-beat steps in bar (even = STEP, odd = step)
  campfireBeat: number; // 0..7 -> 0,1,2=bump, 3=BUMP, 4,5,6=bump, 7=FOOOF!
  phraseIndex: number; // increments every 8 bars
  totalBeats: number;
  isBreakBar: boolean; // true during bar 8 of every 8-bar phrase
  breakStyle: DanceBreakStyle;
  breakProgress: number; // 0..1 across bar 8
  beatPhase: number; // 0..1 within current beat
  justHitBeat: boolean;
}

export interface MidiNoteResult {
  midi: number;
  freq: number;
  noteName: string;
  hue: number;
}

export interface EnsembleVoiceSpec {
  id: string;
  role: InstrumentRole;
  variant: string;
  steps: number[];
  notes?: Array<number | null>;
  gain: number;
  muted: boolean;
  brain: KolmogorovBrain;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToNoteName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const oct = Math.floor(midi / 12) - 1;
  return `${name}${oct}`;
}

export function midiToHue(midi: number): number {
  return (((midi % 12) * 30) + 16) % 360;
}

class TastefulSoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private zynGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  private delayLeft: DelayNode | null = null;
  private delayRight: DelayNode | null = null;
  private delaySend: GainNode | null = null;
  private lofiWet: GainNode | null = null;
  private lofiCrusher: WaveShaperNode | null = null;
  private lofiFilter: BiquadFilterNode | null = null;
  private mediaDest: MediaStreamAudioDestinationNode | null = null;

  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;

  private mode: AudioSourceMode = 'synth';
  private volume = 0.72;
  private isStarted = false;

  // Phase-locked Master Musical Clock (single source of truth for audio + campfire + BPM-coupled step FPS!)
  private bpm = DEFAULT_BPM;
  private manualBpm = DEFAULT_BPM;
  private scale: MusicalScaleId = 'D-lydian';
  private phaseBeats = 0;
  private lastClockAdvanceMs = performance.now();
  private lastReportedBeat = -1;
  private lastScheduledSixteenth = -1;

  // Real-time Microphone Onset BPM Detector state
  private micPrevBass = 0;
  private micAvgFlux = 0.04;
  private micOnsetTimes: number[] = [];
  private micLastOnsetMs = 0;

  // Active Crystal Fae ensemble voices (4 Drums + 3 Drei Stars Singers)
  private ensembleVoices: EnsembleVoiceSpec[] = [];
  private onCharacterSing:
    | ((characterId: string, hue: number, role: InstrumentRole, velocity: number) => void)
    | null = null;
  private onEnsembleMidiEvent:
    | ((role: InstrumentRole, midi: number | null, velocity: number, durationMs: number) => void)
    | null = null;

  // ZynLite synth parameters
  private zynParams: ZynSynthParams = {
    patch: 'pad-glass',
    cutoff: 2400,
    resonance: 2.2,
    detune: 11,
    release: 0.72,
    octave: 0,
  };

  // Smoothed frequency bands
  private smoothBass = 0;
  private smoothMid = 0;
  private smoothTreble = 0;
  private lastBeatTime = 0;
  private midiEnergyBoost = 0;

  public getMode(): AudioSourceMode {
    return this.mode;
  }

  public getVolume(): number {
    return this.volume;
  }

  public getBpm(): number {
    return Math.round(this.bpm);
  }

  public setBpm(nextBpm: number): number {
    const clamped = Math.round(Math.max(MIN_BPM, Math.min(MAX_BPM, nextBpm)));
    this.manualBpm = clamped;
    this.bpm = clamped;

    // Keep stereo tape delay musically synced to the new BPM (1/8 note & dotted 1/8 note)
    if (this.ctx && this.delayLeft && this.delayRight) {
      const beatSec = 60 / clamped;
      const now = this.ctx.currentTime;
      this.delayLeft.delayTime.setTargetAtTime(Math.min(0.95, beatSec * 0.5), now, 0.05);
      this.delayRight.delayTime.setTargetAtTime(Math.min(0.95, beatSec * 0.75), now, 0.05);
    }
    return clamped;
  }

  public getScale(): MusicalScaleId {
    return this.scale;
  }

  public setScale(nextScale: MusicalScaleId): void {
    this.scale = nextScale;
  }

  public getZynParams(): ZynSynthParams {
    return { ...this.zynParams };
  }

  public setZynParams(patch: Partial<ZynSynthParams>): ZynSynthParams {
    this.zynParams = { ...this.zynParams, ...patch };
    return this.getZynParams();
  }

  public isInitialized(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  public setEnsembleVoices(voices: EnsembleVoiceSpec[]): void {
    this.ensembleVoices = voices;
  }

  public setCharacterSingCallback(
    cb: ((characterId: string, hue: number, role: InstrumentRole, velocity: number) => void) | null
  ): void {
    this.onCharacterSing = cb;
  }

  public setEnsembleMidiEventCallback(
    cb: ((role: InstrumentRole, midi: number | null, velocity: number, durationMs: number) => void) | null
  ): void {
    this.onEnsembleMidiEvent = cb;
  }

  public getMasterAudioStream(): MediaStream | null {
    return this.mediaDest ? this.mediaDest.stream : null;
  }

  /**
   * Unified Master Musical Clock:
   * - Advances smoothly from a single continuous phase accumulator (zero phase jumps when dragging BPM).
   * - Exposes exactBeats & animFps (= 0.2 * bpm) so every marcher's half-beat STEP/step walk locks to BPM.
   * - Triggers the 16-step per-marcher instrument ensemble & 8-beat campfire rhythm in sample-tight sync.
   */
  public getMusicalClock(nowPerfMs = performance.now()): MusicalClock {
    const dtSec = Math.min(0.1, Math.max(0, (nowPerfMs - this.lastClockAdvanceMs) / 1000));
    this.lastClockAdvanceMs = nowPerfMs;

    this.phaseBeats += dtSec * (this.bpm / 60);

    const exactBeats = Math.max(0, this.phaseBeats);
    const totalBeats = Math.floor(exactBeats);
    const beatPhase = exactBeats - totalBeats;
    const beatInBar = (totalBeats % 4) + 1; // 1..4
    const totalSixteenths = Math.floor(exactBeats * 4);
    const step16 = totalSixteenths % 16; // 0..15 within 4/4 bar
    const halfBeatIndex = Math.floor(exactBeats * 2) % 8; // 0..7 -> even=STEP, odd=step
    const campfireBeat = totalBeats % 8; // 0..7 (0,1,2=bump, 3=BUMP, 4,5,6=bump, 7=FOOOF!)
    const totalBars = Math.floor(totalBeats / 4);
    const barInPhrase = (totalBars % 8) + 1; // 1..8
    const phraseIndex = Math.floor(totalBars / 8);
    const isBreakBar = barInPhrase === 8;
    const breakStyle = BREAK_ROTATION[phraseIndex % BREAK_ROTATION.length];
    const breakProgress = isBreakBar ? (exactBeats % 4) / 4 : 0;

    const justHitBeat = totalBeats !== this.lastReportedBeat;
    if (justHitBeat) {
      this.lastReportedBeat = totalBeats;
      this.lastBeatTime = nowPerfMs;
    }

    // Exact phase-locked 16th-note audio trigger (guarantees drums, singers, campfire & footsteps never drift!)
    if (totalSixteenths !== this.lastScheduledSixteenth) {
      this.lastScheduledSixteenth = totalSixteenths;
      if (this.mode === 'synth' && this.ctx && this.ctx.state === 'running') {
        this.triggerSyncedEnsembleStep(totalSixteenths);
      }
    }

    const roundedBpm = Math.round(this.bpm);
    return {
      bpm: roundedBpm,
      animFps: bpmToAnimFps(this.bpm),
      exactBeats,
      barInPhrase,
      beatInBar,
      step16,
      halfBeatIndex,
      campfireBeat,
      phraseIndex,
      totalBeats,
      isBreakBar,
      breakStyle,
      breakProgress,
      beatPhase,
      justHitBeat,
    };
  }

  private resolveScaleMidi(role: InstrumentRole, degreeIndex: number): number {
    const spec = SCALE_INTERVALS[this.scale] ?? SCALE_INTERVALS['D-lydian'];
    const len = spec.intervals.length;
    const idx = ((degreeIndex % len) + len) % len;
    const octOffset = role === 'bass' ? -12 : role === 'melody' ? 12 : 0;
    return spec.rootMidi + octOffset + spec.intervals[idx];
  }

  /**
   * Sample-tight 16-step per-marcher engine + 8-beat campfire pulse:
   * - Each marcher plays its own instrument role + variant on its active 16th steps.
   * - Campfire breathes organic wood crackle on Beat 4 (BUMP) and warm flare on Beat 8 (FOOOF!).
   */
  private triggerSyncedEnsembleStep(totalSixteenths: number): void {
    if (!this.ctx || this.ctx.state !== 'running' || this.mode !== 'synth') return;

    const now = this.ctx.currentTime + 0.01;
    const step16 = totalSixteenths % 16;
    const beatInCycle8 = Math.floor(totalSixteenths / 4) % 8; // 0..7 across 2 bars
    const isQuarterBeat = totalSixteenths % 4 === 0;
    const stepSec = 60 / this.bpm / 4;

    // 1. Exact 8-beat Campfire Hearth Accents (subtle crackle on BUMP, warm bloom on FOOOF!)
    if (isQuarterBeat) {
      if (beatInCycle8 === 7) {
        this.playCampfireFooof(now);
      } else if (beatInCycle8 === 3) {
        this.playCampfireCrackle(now + 0.015, 0.09);
      } else if (beatInCycle8 % 2 === 1) {
        this.playCampfireCrackle(now + 0.025, 0.042);
      }
    }

    // 2. Every active marcher performs its dedicated instrument (4 drums + 3 Drei Stars singers)
    for (const voice of this.ensembleVoices) {
      if (voice.muted) continue;

      const stepVel = voice.steps?.[step16] ?? 0;
      if (stepVel <= 0.01) continue;

      const level = Math.max(0.05, Math.min(1.2, stepVel * (voice.gain ?? 0.82)));
      const hue = isSingerRole(voice.role)
        ? voice.brain.accentHue
        : voice.brain.shapes[step16 % 3].hue;

      if (voice.role === 'kick') {
        this.playDrumKick(voice.variant, now, level);
        this.onEnsembleMidiEvent?.('kick', null, stepVel, stepSec * 900);
      } else if (voice.role === 'snare') {
        this.playDrumSnare(voice.variant, now, level);
        this.onEnsembleMidiEvent?.('snare', null, stepVel, stepSec * 900);
      } else if (voice.role === 'hat') {
        this.playDrumHat(voice.variant, now, level);
        this.onEnsembleMidiEvent?.('hat', null, stepVel, stepSec * 650);
      } else if (voice.role === 'perc') {
        const pitchStep = (((step16 + Math.floor(voice.brain.bodyHue / 40)) % 5) + 5) % 5;
        this.playDrumPerc(voice.variant, now, level, pitchStep);
        this.onEnsembleMidiEvent?.('perc', null, stepVel, stepSec * 800);
      } else {
        const explicitMidi = voice.notes?.[step16];
        const midi =
          typeof explicitMidi === 'number'
            ? explicitMidi
            : this.resolveScaleMidi(voice.role, step16 + Math.floor(voice.brain.shapes[0].hue / 45));
        const freq = midiToFreq(midi);

        if (voice.role === 'bass') {
          this.playSingerBass(voice.variant, freq, now, stepSec * 3.1, level);
          this.onEnsembleMidiEvent?.('bass', midi, stepVel, stepSec * 3000);
        } else if (voice.role === 'melody') {
          this.playSingerMelody(voice.variant, freq, now, stepSec * 2.6, level, voice.brain.complexity);
          this.onEnsembleMidiEvent?.('melody', midi, stepVel, stepSec * 2500);
        } else {
          this.playSingerHarmony(voice.variant, freq, now, stepSec * 4.4, level);
          this.onEnsembleMidiEvent?.('harmony', midi, stepVel, stepSec * 4200);
        }
      }

      this.onCharacterSing?.(voice.id, hue, voice.role, stepVel);
    }
  }

  public async ensureReady(): Promise<void> {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.mode === 'muted' ? 0 : this.volume;

      const masterWarmth = this.ctx.createBiquadFilter();
      masterWarmth.type = 'lowpass';
      masterWarmth.frequency.value = 9200;
      masterWarmth.Q.value = 0.5;

      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 18;
      compressor.ratio.value = 3.2;
      compressor.attack.value = 0.012;
      compressor.release.value = 0.22;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.72;
      this.freqData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.54;

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.92;

      this.zynGain = this.ctx.createGain();
      this.zynGain.gain.value = 0.85;

      // Algorithmic Warm Hall Convolution Reverb
      this.reverbNode = this.ctx.createConvolver();
      this.reverbNode.buffer = this.createWarmReverbImpulse(this.ctx, 2.7, 2.4);
      this.reverbSend = this.ctx.createGain();
      this.reverbSend.gain.value = 0.36;
      const reverbTone = this.ctx.createBiquadFilter();
      reverbTone.type = 'lowpass';
      reverbTone.frequency.value = 2600;
      this.reverbSend.connect(this.reverbNode);
      this.reverbNode.connect(reverbTone);
      reverbTone.connect(this.masterGain);

      // Stereo Tape Delay
      this.delaySend = this.ctx.createGain();
      this.delaySend.gain.value = 0.28;
      this.delayLeft = this.ctx.createDelay(1.0);
      this.delayRight = this.ctx.createDelay(1.0);
      this.delayLeft.delayTime.value = 0.294;
      this.delayRight.delayTime.value = 0.441;

      const delayFbL = this.ctx.createGain();
      const delayFbR = this.ctx.createGain();
      delayFbL.gain.value = 0.34;
      delayFbR.gain.value = 0.32;

      const delayLp = this.ctx.createBiquadFilter();
      delayLp.type = 'lowpass';
      delayLp.frequency.value = 1950;

      const merger = this.ctx.createChannelMerger(2);
      this.delaySend.connect(delayLp);
      delayLp.connect(this.delayLeft);
      delayLp.connect(this.delayRight);
      this.delayLeft.connect(delayFbL);
      delayFbL.connect(this.delayRight);
      this.delayRight.connect(delayFbR);
      delayFbR.connect(this.delayLeft);
      this.delayLeft.connect(merger, 0, 0);
      this.delayRight.connect(merger, 0, 1);
      merger.connect(this.masterGain);

      // Parallel Tasteful Lo-Fi 12-bit DAC Warmth Bus
      this.lofiCrusher = this.ctx.createWaveShaper();
      this.lofiCrusher.curve = this.createWarmBitCrushCurve(22);
      this.lofiCrusher.oversample = '2x';

      this.lofiFilter = this.ctx.createBiquadFilter();
      this.lofiFilter.type = 'lowpass';
      this.lofiFilter.frequency.value = 2850;
      this.lofiFilter.Q.value = 0.85;

      this.lofiWet = this.ctx.createGain();
      this.lofiWet.gain.value = 0.26;

      this.lofiCrusher.connect(this.lofiFilter);
      this.lofiFilter.connect(this.lofiWet);
      this.lofiWet.connect(this.masterGain);

      this.musicGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.zynGain.connect(this.masterGain);
      this.masterGain.connect(masterWarmth);
      masterWarmth.connect(compressor);
      compressor.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      // Studio recording tap right after master bus compressor
      if (typeof this.ctx.createMediaStreamDestination === 'function') {
        this.mediaDest = this.ctx.createMediaStreamDestination();
        compressor.connect(this.mediaDest);
      }
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    if (!this.isStarted) {
      this.isStarted = true;
    }
  }

  private createWarmBitCrushCurve(steps: number): Float32Array<ArrayBuffer> {
    const samples = 2048;
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      const sat = Math.tanh(x * 1.35);
      const q = Math.round(sat * steps) / steps;
      curve[i] = q * 0.65 + sat * 0.35;
    }
    return curve;
  }

  private createWarmReverbImpulse(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const env = Math.pow(1 - i / length, decay);
        const white = Math.random() * 2 - 1;
        lp = lp * 0.72 + white * 0.28;
        data[i] = lp * env;
      }
    }
    return buffer;
  }

  public setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx && this.mode !== 'muted') {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.04);
    }
  }

  public async setMode(nextMode: AudioSourceMode): Promise<void> {
    this.mode = nextMode;
    await this.ensureReady();
    if (!this.ctx || !this.masterGain || !this.musicGain) return;

    const now = this.ctx.currentTime;
    this.stopMic();

    if (nextMode === 'muted') {
      this.bpm = this.manualBpm;
      this.masterGain.gain.setTargetAtTime(0, now, 0.06);
      return;
    }

    this.masterGain.gain.setTargetAtTime(this.volume, now, 0.06);

    if (nextMode === 'synth') {
      this.bpm = this.manualBpm;
      this.musicGain.gain.setTargetAtTime(0.56, now, 0.08);
    } else if (nextMode === 'mic') {
      this.musicGain.gain.setTargetAtTime(0.0, now, 0.08);
      this.micOnsetTimes = [];
      this.micAvgFlux = 0.04;
      this.micPrevBass = 0;
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (this.ctx && this.analyser) {
          this.micSource = this.ctx.createMediaStreamSource(this.micStream);
          this.micSource.connect(this.analyser);
        }
      } catch {
        this.mode = 'synth';
        this.bpm = this.manualBpm;
        this.musicGain.gain.setTargetAtTime(0.56, now, 0.08);
      }
    }
  }

  private stopMic(): void {
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
  }

  /**
   * Real-time spectral-flux onset detector & IOI median BPM tracker for Microphone mode.
   * Locks the campfire's 8-beat bump/BUMP/FOOOF! rhythm and Fae dancers to external music.
   */
  private processMicBpmDetection(rawBass: number, nowPerfMs: number): void {
    const flux = Math.max(0, rawBass - this.micPrevBass);
    this.micPrevBass = rawBass;
    this.micAvgFlux = this.micAvgFlux * 0.94 + flux * 0.06;

    const threshold = Math.max(0.055, this.micAvgFlux * 2.15);
    const minRefractoryMs = 270; // up to ~220 BPM cap before folding

    if (flux > threshold && rawBass > 0.22 && nowPerfMs - this.micLastOnsetMs > minRefractoryMs) {
      this.micLastOnsetMs = nowPerfMs;
      this.micOnsetTimes.push(nowPerfMs);
      if (this.micOnsetTimes.length > 10) {
        this.micOnsetTimes.shift();
      }

      // Gently nudge beat phase toward the detected onset so campfire lands on the beat
      const frac = this.phaseBeats - Math.floor(this.phaseBeats);
      if (frac > 0.5) {
        this.phaseBeats += (1 - frac) * 0.28;
      } else {
        this.phaseBeats -= frac * 0.28;
      }

      if (this.micOnsetTimes.length >= 4) {
        const bpmCandidates: number[] = [];
        for (let i = 1; i < this.micOnsetTimes.length; i++) {
          const ioiSec = (this.micOnsetTimes[i] - this.micOnsetTimes[i - 1]) / 1000;
          if (ioiSec <= 0.15 || ioiSec > 1.8) continue;
          let candidate = 60 / ioiSec;
          while (candidate < 72) candidate *= 2;
          while (candidate > 156) candidate /= 2;
          bpmCandidates.push(candidate);
        }

        if (bpmCandidates.length >= 3) {
          bpmCandidates.sort((a, b) => a - b);
          const medianBpm = bpmCandidates[Math.floor(bpmCandidates.length / 2)];
          // Smooth slew toward detected tempo to prevent jitter
          this.bpm = this.bpm * 0.8 + medianBpm * 0.2;
        }
      }
    }
  }

  /**
   * ZYN-LITE POLYPHONIC RETRO SYNTH (LMMS ZynAddSubFX inspired)
   */
  public playZynNote(baseMidi: number, velocity = 0.82, skipOctaveShift = false): MidiNoteResult {
    const shifted = skipOctaveShift ? baseMidi : baseMidi + this.zynParams.octave * 12;
    const midi = Math.max(24, Math.min(108, shifted));
    const freq = midiToFreq(midi);
    const result: MidiNoteResult = {
      midi,
      freq,
      noteName: midiToNoteName(midi),
      hue: midiToHue(midi),
    };

    this.midiEnergyBoost = Math.min(1, this.midiEnergyBoost + 0.55);

    void this.ensureReady().then(() => {
      if (!this.ctx || !this.zynGain || !this.reverbSend || !this.delaySend || !this.lofiCrusher) return;
      if (this.mode === 'muted') return;

      const ctx = this.ctx;
      const now = ctx.currentTime + 0.005;
      const p = this.zynParams;
      const rel = Math.max(0.1, p.release);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = Math.min(9.5, p.resonance);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);

      const oscs: OscillatorNode[] = [];

      if (p.patch === 'pad-glass') {
        const ratios = [1, 1, 2];
        const detunes = [-p.detune, p.detune, p.detune * 0.4];
        const types: OscillatorType[] = ['triangle', 'sawtooth', 'sine'];
        ratios.forEach((r, idx) => {
          const osc = ctx.createOscillator();
          osc.type = types[idx];
          osc.frequency.setValueAtTime(freq * r, now);
          osc.detune.setValueAtTime(detunes[idx], now);
          const g = ctx.createGain();
          g.gain.value = idx === 1 ? 0.35 : idx === 2 ? 0.28 : 0.65;
          osc.connect(g);
          g.connect(filter);
          oscs.push(osc);
        });
        filter.frequency.setValueAtTime(Math.min(5400, p.cutoff * 0.65), now);
        filter.frequency.exponentialRampToValueAtTime(Math.min(6800, p.cutoff * 1.45), now + 0.14);
        filter.frequency.exponentialRampToValueAtTime(Math.max(320, p.cutoff * 0.5), now + rel + 0.35);

        env.gain.linearRampToValueAtTime(0.24 * velocity, now + 0.055);
        env.gain.exponentialRampToValueAtTime(0.0001, now + rel + 0.45);
      } else if (p.patch === 'ad-brass') {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const sub = ctx.createOscillator();
        osc1.type = 'sawtooth';
        osc2.type = 'sawtooth';
        sub.type = 'sine';
        osc1.frequency.setValueAtTime(freq, now);
        osc2.frequency.setValueAtTime(freq, now);
        osc1.detune.setValueAtTime(-p.detune, now);
        osc2.detune.setValueAtTime(p.detune, now);
        sub.frequency.setValueAtTime(freq * 0.5, now);

        const subG = ctx.createGain();
        subG.gain.value = 0.45;
        osc1.connect(filter);
        osc2.connect(filter);
        sub.connect(subG);
        subG.connect(filter);
        oscs.push(osc1, osc2, sub);

        filter.frequency.setValueAtTime(Math.max(240, p.cutoff * 0.35), now);
        filter.frequency.exponentialRampToValueAtTime(Math.min(5600, p.cutoff * 1.55), now + 0.16);
        filter.frequency.exponentialRampToValueAtTime(Math.max(260, p.cutoff * 0.45), now + rel + 0.28);

        env.gain.linearRampToValueAtTime(0.22 * velocity, now + 0.035);
        env.gain.exponentialRampToValueAtTime(0.0001, now + rel + 0.35);
      } else if (p.patch === 'sub-pluck') {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        osc1.type = 'triangle';
        osc2.type = 'square';
        osc1.frequency.setValueAtTime(freq, now);
        osc2.frequency.setValueAtTime(freq * 2, now);
        osc2.detune.setValueAtTime(p.detune * 0.7, now);

        const g2 = ctx.createGain();
        g2.gain.value = 0.16;
        osc1.connect(filter);
        osc2.connect(g2);
        g2.connect(filter);
        oscs.push(osc1, osc2);

        filter.frequency.setValueAtTime(Math.min(6400, p.cutoff * 2.1), now);
        filter.frequency.exponentialRampToValueAtTime(Math.max(260, p.cutoff * 0.32), now + Math.min(0.45, rel));

        env.gain.linearRampToValueAtTime(0.28 * velocity, now + 0.008);
        env.gain.exponentialRampToValueAtTime(0.0001, now + rel * 0.85 + 0.12);
      } else if (p.patch === 'fm-bell') {
        const carrier = ctx.createOscillator();
        const mod = ctx.createOscillator();
        const modGain = ctx.createGain();
        carrier.type = 'sine';
        mod.type = 'sine';
        carrier.frequency.setValueAtTime(freq, now);
        mod.frequency.setValueAtTime(freq * 3.0, now);
        mod.detune.setValueAtTime(p.detune * 0.5, now);

        modGain.gain.setValueAtTime(freq * 1.15, now);
        modGain.gain.exponentialRampToValueAtTime(1.0, now + Math.min(0.6, rel));

        mod.connect(modGain);
        modGain.connect(carrier.frequency);
        carrier.connect(filter);
        oscs.push(carrier, mod);

        filter.frequency.setValueAtTime(Math.min(6200, p.cutoff * 1.5), now);
        env.gain.linearRampToValueAtTime(0.26 * velocity, now + 0.008);
        env.gain.exponentialRampToValueAtTime(0.0001, now + rel + 0.35);
      } else {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        osc1.type = 'sawtooth';
        osc2.type = 'square';
        osc1.frequency.setValueAtTime(freq * 0.5, now);
        osc2.frequency.setValueAtTime(freq * 0.5, now);
        osc2.detune.setValueAtTime(p.detune, now);

        const g2 = ctx.createGain();
        g2.gain.value = 0.28;
        osc1.connect(filter);
        osc2.connect(g2);
        g2.connect(filter);
        oscs.push(osc1, osc2);

        filter.frequency.setValueAtTime(Math.min(3600, p.cutoff * 1.6), now);
        filter.frequency.exponentialRampToValueAtTime(Math.max(180, p.cutoff * 0.25), now + Math.min(0.35, rel));

        env.gain.linearRampToValueAtTime(0.28 * velocity, now + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0001, now + rel * 0.9 + 0.14);
      }

      filter.connect(env);
      env.connect(this.zynGain);
      env.connect(this.reverbSend);
      env.connect(this.delaySend);
      env.connect(this.lofiCrusher);

      const stopAt = now + rel + 0.55;
      for (const osc of oscs) {
        osc.start(now);
        osc.stop(stopAt);
      }
    });

    return result;
  }

  /**
   * SIGNATURE SPAWN BOOTUP SOUND:
   * Classic retro console 1-2-3 startup sculpted with Hans Zimmer deep cello/brass sub bloom
   * + Tycho warm Rhodes/bell plucks + parallel warm 12-bit DAC lo-fi crunch.
   */
  public async playBootupChime(seedOffset = 0): Promise<void> {
    await this.ensureReady();
    if (!this.ctx || !this.sfxGain || !this.reverbSend || !this.delaySend || !this.lofiCrusher) return;
    if (this.mode === 'muted') return;

    const ctx = this.ctx;
    const now = ctx.currentTime + 0.01;
    const semiChoices = [0, 2, -2, 5, 0, 7];
    const semi = semiChoices[Math.abs(seedOffset) % semiChoices.length];
    const ratio = Math.pow(2, semi / 12);

    this.playWarmAirSwell(now, 0.55, 0.16);
    this.playZimmerBloom(73.42 * ratio, now, 2.35, 0.24);
    this.playZimmerBloom(110.0 * ratio, now + 0.04, 2.2, 0.14);

    const motif: Array<{ time: number; freq: number; dur: number; vel: number }> = [
      { time: 0.18, freq: 293.66 * ratio, dur: 0.32, vel: 0.22 },
      { time: 0.33, freq: 369.99 * ratio, dur: 0.28, vel: 0.21 },
      { time: 0.48, freq: 440.0 * ratio, dur: 0.34, vel: 0.24 },
      { time: 0.66, freq: 554.37 * ratio, dur: 0.28, vel: 0.2 },
      { time: 0.8, freq: 659.25 * ratio, dur: 0.58, vel: 0.26 },
    ];

    for (const note of motif) {
      this.playLofiConsoleBell(note.freq, now + note.time, note.dur, note.vel);
    }

    const resolveTime = now + 0.96;
    const resolveNotes = [
      293.66 * ratio,
      369.99 * ratio,
      440.0 * ratio,
      554.37 * ratio,
      659.25 * ratio,
      880.0 * ratio,
    ];

    resolveNotes.forEach((freq, idx) => {
      const gain = idx === resolveNotes.length - 1 ? 0.07 : 0.11;
      this.playShimmerPadVoice(freq, resolveTime + idx * 0.022, 1.85, gain);
    });
    this.playWarmAirSwell(resolveTime, 0.72, 0.11);
  }

  public async playAbandonChime(): Promise<void> {
    await this.ensureReady();
    if (!this.ctx || !this.sfxGain || this.mode === 'muted') return;
    const now = this.ctx.currentTime + 0.01;
    this.playLofiConsoleBell(329.63, now, 0.35, 0.15);
    this.playLofiConsoleBell(440.0, now + 0.09, 0.45, 0.17);
  }

  public playBreakSwell(): void {
    if (!this.ctx || this.ctx.state !== 'running' || this.mode === 'muted') return;
    const now = this.ctx.currentTime + 0.01;
    this.playWarmAirSwell(now, 0.85, 0.11);
    this.playLofiConsoleBell(587.33, now + 0.04, 0.55, 0.14);
    this.playLofiConsoleBell(880.0, now + 0.18, 0.65, 0.11);
  }

  /**
   * Tasteful organic wood-hearth crackle (subtle warm bandpassed spark pops — never harsh static)
   */
  private playCampfireCrackle(startTime: number, level: number): void {
    if (!this.ctx || !this.musicGain || !this.reverbSend) return;
    const ctx = this.ctx;
    const dur = 0.065;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      // Sparse organic ember snap envelope
      const snap = i < len * 0.18 ? 1 : Math.random() > 0.92 ? 0.65 : 0.08;
      d[i] = (Math.random() * 2 - 1) * snap * Math.pow(1 - i / len, 2.4);
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1850 + Math.random() * 650;
    bp.Q.value = 1.9;

    const gain = ctx.createGain();
    gain.gain.value = level;

    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.musicGain);
    gain.connect(this.reverbSend);
    src.start(startTime);
  }

  /**
   * Beat-8 Campfire FOOOF! — warm buoyant low-mid breathy flame bloom + twin golden ember crackles
   */
  private playCampfireFooof(startTime: number): void {
    if (!this.ctx || !this.musicGain || !this.reverbSend) return;
    const ctx = this.ctx;
    const dur = 0.52;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.992 * b0 + w * 0.05;
      b1 = 0.96 * b1 + w * 0.07;
      d[i] = (b0 + b1) * 1.45;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(210, startTime);
    filter.frequency.exponentialRampToValueAtTime(920, startTime + 0.16);
    filter.frequency.exponentialRampToValueAtTime(310, startTime + dur);
    filter.Q.value = 1.1;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(0.19, startTime + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    gain.connect(this.reverbSend);
    src.start(startTime);
    src.stop(startTime + dur + 0.03);

    // Subtle crisp sparkle crackles riding the FOOOF! flare
    this.playCampfireCrackle(startTime + 0.04, 0.11);
    this.playCampfireCrackle(startTime + 0.14, 0.075);
  }

  private playWarmAirSwell(startTime: number, duration: number, level: number): void {
    if (!this.ctx || !this.sfxGain || !this.reverbSend) return;
    const ctx = this.ctx;
    const bufLen = Math.floor(ctx.sampleRate * duration);
    const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < bufLen; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029;
      b1 = 0.985 * b1 + w * 0.032;
      b2 = 0.95 * b2 + w * 0.048;
      data[i] = (b0 + b1 + b2 + w * 0.015) * 1.4;
    }

    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(480, startTime);
    bp.frequency.exponentialRampToValueAtTime(1900, startTime + duration * 0.65);
    bp.frequency.exponentialRampToValueAtTime(850, startTime + duration);
    bp.Q.value = 1.4;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(level, startTime + duration * 0.45);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.sfxGain);
    gain.connect(this.reverbSend);

    src.start(startTime);
    src.stop(startTime + duration + 0.02);
  }

  private playZimmerBloom(freq: number, startTime: number, duration: number, level: number): void {
    if (!this.ctx || !this.sfxGain || !this.reverbSend) return;
    const ctx = this.ctx;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const sub = ctx.createOscillator();

    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';
    sub.type = 'sine';

    osc1.frequency.setValueAtTime(freq, startTime);
    osc2.frequency.setValueAtTime(freq * 1.0045, startTime);
    sub.frequency.setValueAtTime(freq * 0.5, startTime);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(140, startTime);
    filter.frequency.exponentialRampToValueAtTime(880, startTime + duration * 0.42);
    filter.frequency.exponentialRampToValueAtTime(240, startTime + duration);
    filter.Q.value = 1.1;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(level, startTime + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc1.connect(filter);
    osc2.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    gain.connect(this.reverbSend);

    osc1.start(startTime);
    osc2.start(startTime);
    sub.start(startTime);
    osc1.stop(startTime + duration + 0.05);
    osc2.stop(startTime + duration + 0.05);
    sub.stop(startTime + duration + 0.05);
  }

  private playLofiConsoleBell(freq: number, startTime: number, duration: number, level: number): void {
    if (!this.ctx || !this.sfxGain || !this.reverbSend || !this.delaySend || !this.lofiCrusher) return;
    const ctx = this.ctx;

    const carrier = ctx.createOscillator();
    const harmonic = ctx.createOscillator();
    const harmGain = ctx.createGain();

    carrier.type = 'triangle';
    harmonic.type = 'sine';
    carrier.frequency.setValueAtTime(freq * 0.993, startTime);
    carrier.frequency.exponentialRampToValueAtTime(freq, startTime + 0.035);
    harmonic.frequency.setValueAtTime(freq * 2.0, startTime);

    harmGain.gain.setValueAtTime(0.24, startTime);
    harmGain.gain.exponentialRampToValueAtTime(0.01, startTime + duration * 0.6);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3400, startTime);
    filter.frequency.exponentialRampToValueAtTime(1100, startTime + duration);
    filter.Q.value = 0.7;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(level, startTime + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + 0.25);

    carrier.connect(filter);
    harmonic.connect(harmGain);
    harmGain.connect(filter);
    filter.connect(env);

    env.connect(this.sfxGain);
    env.connect(this.reverbSend);
    env.connect(this.delaySend);
    env.connect(this.lofiCrusher);

    carrier.start(startTime);
    harmonic.start(startTime);
    carrier.stop(startTime + duration + 0.3);
    harmonic.stop(startTime + duration + 0.3);
  }

  private playShimmerPadVoice(freq: number, startTime: number, duration: number, level: number): void {
    if (!this.ctx || !this.sfxGain || !this.reverbSend || !this.lofiCrusher) return;
    const ctx = this.ctx;

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'triangle';
    oscB.type = 'sine';
    oscA.frequency.setValueAtTime(freq, startTime);
    oscB.frequency.setValueAtTime(freq * 1.003, startTime);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2800, startTime);
    filter.frequency.exponentialRampToValueAtTime(950, startTime + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(level, startTime + 0.14);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(env);
    env.connect(this.sfxGain);
    env.connect(this.reverbSend);
    env.connect(this.lofiCrusher);

    oscA.start(startTime);
    oscB.start(startTime);
    oscA.stop(startTime + duration + 0.06);
    oscB.stop(startTime + duration + 0.06);
  }

  // ==================== 4 DRUM MARCHER SYNTH ENGINES (3 VARIANTS EACH) ====================

  private playDrumKick(variant: string, startTime: number, level: number): void {
    if (!this.ctx || !this.musicGain) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = variant === 'hearth-thump' ? 'triangle' : 'sine';

    const startHz = variant === '808-bloom' ? 132 : variant === 'hearth-thump' ? 104 : 122;
    const endHz = variant === '808-bloom' ? 38 : variant === 'hearth-thump' ? 48 : 44;
    const decay = variant === '808-bloom' ? 0.42 : variant === 'hearth-thump' ? 0.24 : 0.28;

    osc.frequency.setValueAtTime(startHz, startTime);
    osc.frequency.exponentialRampToValueAtTime(endHz, startTime + 0.12);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = variant === 'hearth-thump' ? 260 : 380;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(0.38 * level, startTime + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + decay);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    osc.start(startTime);
    osc.stop(startTime + decay + 0.03);
  }

  private playDrumSnare(variant: string, startTime: number, level: number): void {
    if (!this.ctx || !this.musicGain || !this.reverbSend) return;
    const ctx = this.ctx;
    const dur = variant === 'brush-snap' ? 0.16 : variant === 'tape-crack' ? 0.14 : 0.11;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, variant === 'brush-snap' ? 1.5 : 2.3);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = variant === 'wood-rim' ? 1650 : variant === 'brush-snap' ? 2850 : 2100;
    bp.Q.value = variant === 'wood-rim' ? 2.4 : 1.1;

    const nGain = ctx.createGain();
    nGain.gain.value = (variant === 'brush-snap' ? 0.13 : 0.16) * level;

    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(this.musicGain);
    nGain.connect(this.reverbSend);
    noise.start(startTime);

    // Warm pitched wood/body knock underneath
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(variant === 'wood-rim' ? 310 : 210, startTime);
    body.frequency.exponentialRampToValueAtTime(variant === 'wood-rim' ? 160 : 105, startTime + 0.06);
    const bGain = ctx.createGain();
    bGain.gain.setValueAtTime(0.0001, startTime);
    bGain.gain.linearRampToValueAtTime(0.15 * level, startTime + 0.005);
    bGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.09);

    body.connect(bGain);
    bGain.connect(this.musicGain);
    if (variant === 'tape-crack' && this.lofiCrusher) {
      bGain.connect(this.lofiCrusher);
    }
    body.start(startTime);
    body.stop(startTime + 0.1);
  }

  private playDrumHat(variant: string, startTime: number, level: number): void {
    if (!this.ctx || !this.musicGain || !this.reverbSend) return;
    const ctx = this.ctx;
    const dur = variant === 'open-shimmer' ? 0.17 : variant === 'moss-shaker' ? 0.09 : 0.055;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = variant === 'moss-shaker' ? Math.sin((i / len) * Math.PI) : Math.pow(1 - i / len, 2.6);
      d[i] = (Math.random() * 2 - 1) * env;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = variant === 'crystal-tick' ? 5400 : variant === 'moss-shaker' ? 3800 : 4600;
    filter.Q.value = variant === 'crystal-tick' ? 2.6 : 1.3;

    const g = ctx.createGain();
    g.gain.value = 0.095 * level;

    src.connect(filter);
    filter.connect(g);
    g.connect(this.musicGain);
    if (variant === 'open-shimmer') g.connect(this.reverbSend);
    src.start(startTime);
  }

  private playDrumPerc(variant: string, startTime: number, level: number, pitchStep: number): void {
    if (!this.ctx || !this.musicGain || !this.delaySend || !this.reverbSend) return;
    const ctx = this.ctx;
    const baseFreqs =
      variant === 'kalimba-wood'
        ? [293.66, 329.63, 369.99, 440.0, 493.88]
        : variant === 'chime-conga'
          ? [196.0, 220.0, 246.94, 293.66, 329.63]
          : [110.0, 130.81, 146.83, 164.81, 196.0];
    const freq = baseFreqs[pitchStep % baseFreqs.length];
    const dur = variant === 'kalimba-wood' ? 0.24 : 0.2;

    const osc = ctx.createOscillator();
    osc.type = variant === 'ember-tom' ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(freq * (variant === 'ember-tom' ? 1.35 : 1.04), startTime);
    osc.frequency.exponentialRampToValueAtTime(freq, startTime + 0.045);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = variant === 'kalimba-wood' ? 2400 : 1200;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, startTime);
    g.gain.linearRampToValueAtTime(0.18 * level, startTime + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

    osc.connect(lp);
    lp.connect(g);
    g.connect(this.musicGain);
    g.connect(this.reverbSend);
    if (variant === 'kalimba-wood') g.connect(this.delaySend);

    osc.start(startTime);
    osc.stop(startTime + dur + 0.03);
  }

  // ==================== 3 DREI STARS SINGER SYNTH ENGINES (3 VARIANTS EACH) ====================

  private playSingerBass(variant: string, freq: number, startTime: number, duration: number, level: number): void {
    if (!this.ctx || !this.musicGain || !this.reverbSend) return;
    const ctx = this.ctx;
    const dur = Math.max(0.22, variant === 'moss-drone' ? duration * 1.45 : duration);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = variant === 'analog-sub' ? 'triangle' : 'sawtooth';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(freq, startTime);
    osc2.frequency.setValueAtTime(freq * 0.5, startTime);
    if (variant === 'zimmer-cello') {
      osc1.detune.setValueAtTime(5, startTime);
    }

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = variant === 'analog-sub' ? 2.4 : 1.1;
    filter.frequency.setValueAtTime(variant === 'moss-drone' ? 240 : 480, startTime);
    filter.frequency.exponentialRampToValueAtTime(variant === 'zimmer-cello' ? 190 : 140, startTime + dur);

    const g = ctx.createGain();
    const attack = variant === 'moss-drone' ? 0.09 : 0.018;
    g.gain.setValueAtTime(0.0001, startTime);
    g.gain.linearRampToValueAtTime(0.22 * level, startTime + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(g);
    g.connect(this.musicGain);
    if (variant !== 'analog-sub') g.connect(this.reverbSend);

    osc1.start(startTime);
    osc2.start(startTime);
    osc1.stop(startTime + dur + 0.04);
    osc2.stop(startTime + dur + 0.04);
  }

  private playSingerMelody(
    variant: string,
    freq: number,
    startTime: number,
    duration: number,
    level: number,
    complexity: number
  ): void {
    if (!this.ctx || !this.musicGain || !this.delaySend || !this.reverbSend) return;
    const ctx = this.ctx;
    const dur = Math.max(0.24, duration);

    const osc = ctx.createOscillator();
    const harm = ctx.createOscillator();
    const harmG = ctx.createGain();

    osc.type = variant === 'glass-flute' ? 'sine' : 'triangle';
    harm.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);
    harm.frequency.setValueAtTime(freq * (variant === 'tycho-rhodes' ? 3.0 : 2.0), startTime);
    harmG.gain.value = variant === 'glass-flute' ? 0.1 : variant === 'tycho-rhodes' ? 0.14 : 0.2;

    const cutoff = (variant === 'glass-flute' ? 1650 : 2100) + complexity * 1100;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, startTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(460, cutoff * 0.34), startTime + dur);

    const g = ctx.createGain();
    const atk = variant === 'glass-flute' ? 0.045 : 0.01;
    g.gain.setValueAtTime(0.0001, startTime);
    g.gain.linearRampToValueAtTime(0.14 * level, startTime + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

    osc.connect(filter);
    harm.connect(harmG);
    harmG.connect(filter);
    filter.connect(g);
    g.connect(this.musicGain);
    g.connect(this.delaySend);
    g.connect(this.reverbSend);
    if (variant === 'tycho-rhodes' && this.lofiCrusher) {
      g.connect(this.lofiCrusher);
    }

    osc.start(startTime);
    harm.start(startTime);
    osc.stop(startTime + dur + 0.04);
    harm.stop(startTime + dur + 0.04);
  }

  private playSingerHarmony(
    variant: string,
    freq: number,
    startTime: number,
    duration: number,
    level: number
  ): void {
    if (!this.ctx || !this.musicGain || !this.reverbSend || !this.delaySend) return;
    const ctx = this.ctx;
    const dur = Math.max(0.35, variant === 'quartz-arp' ? duration * 0.65 : duration);
    const ratios = variant === 'quartz-arp' ? [1, 1.498] : [1, 1.2599, 1.498]; // Root, 3rd, 5th

    ratios.forEach((r, idx) => {
      const t0 = startTime + (variant === 'quartz-arp' ? idx * 0.045 : idx * 0.01);
      const osc = ctx.createOscillator();
      osc.type = variant === 'warm-brass' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq * r, t0);
      osc.detune.setValueAtTime((idx - 1) * 7, t0);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(variant === 'warm-brass' ? 780 : 1450, t0);
      filter.frequency.exponentialRampToValueAtTime(420, t0 + dur);

      const g = ctx.createGain();
      const atk = variant === 'quartz-arp' ? 0.012 : 0.085;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.072 * level, t0 + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(filter);
      filter.connect(g);
      g.connect(this.musicGain!);
      g.connect(this.reverbSend!);
      if (variant === 'quartz-arp') g.connect(this.delaySend!);

      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    });
  }

  public getAudioBands(elapsedSec: number): AudioBands {
    this.midiEnergyBoost *= 0.88;

    if (this.analyser && this.freqData && this.ctx?.state === 'running' && this.mode !== 'muted') {
      this.analyser.getByteFrequencyData(this.freqData);
      const data = this.freqData;

      const avg = (start: number, end: number) => {
        let sum = 0;
        const count = Math.max(1, end - start);
        for (let i = start; i < end && i < data.length; i++) {
          sum += data[i];
        }
        return sum / (count * 255);
      };

      const rawBass = Math.min(1, avg(0, 4) * 1.45 + this.midiEnergyBoost * 0.25);
      const rawMid = Math.min(1, avg(4, 22) * 2.0 + this.midiEnergyBoost * 0.35);
      const rawTreble = Math.min(1, avg(22, 72) * 2.9 + this.midiEnergyBoost * 0.3);

      // Run live onset BPM tracker when listening via Microphone
      if (this.mode === 'mic') {
        this.processMicBpmDetection(rawBass, performance.now());
      }

      this.smoothBass += (rawBass - this.smoothBass) * 0.3;
      this.smoothMid += (rawMid - this.smoothMid) * 0.26;
      this.smoothTreble += (rawTreble - this.smoothTreble) * 0.26;

      const sinceBeat = (performance.now() - this.lastBeatTime) / 1000;
      const beatPulse = this.mode === 'synth' ? Math.max(0, 1 - sinceBeat * 3.4) : this.smoothBass;

      return {
        bass: this.smoothBass,
        mid: this.smoothMid,
        treble: this.smoothTreble,
        overall: (this.smoothBass + this.smoothMid + this.smoothTreble) / 3,
        beatPulse: Math.min(1, beatPulse + this.midiEnergyBoost * 0.4),
      };
    }

    // Idle pre-gesture fallback curve synced directly to the continuous beat phase
    const beatPhase = this.phaseBeats - Math.floor(this.phaseBeats);
    const beatBump = Math.pow(Math.max(0, 1 - beatPhase * 2.4), 2);
    return {
      bass: Math.min(1, 0.22 + beatBump * 0.48 + this.midiEnergyBoost * 0.3),
      mid: Math.min(1, 0.2 + 0.25 * (0.5 + 0.5 * Math.sin(elapsedSec * 2.6 + 1.1)) + this.midiEnergyBoost * 0.35),
      treble: Math.min(1, 0.18 + 0.24 * (0.5 + 0.5 * Math.sin(elapsedSec * 4.2 + 2.3)) + this.midiEnergyBoost * 0.3),
      overall: 0.24 + beatBump * 0.22,
      beatPulse: Math.min(1, beatBump * 0.75 + this.midiEnergyBoost * 0.4),
    };
  }

  public dispose(): void {
    this.stopMic();
    this.onCharacterSing = null;
    this.onEnsembleMidiEvent = null;
    this.mediaDest = null;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}

export const soundEngine = new TastefulSoundEngine();
