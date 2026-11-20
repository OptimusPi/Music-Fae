import { InstrumentRole } from '../shared/beatSchema';

export interface MidiPortInfo {
  id: string;
  name: string;
  manufacturer: string;
}

export interface MidiHubSnapshot {
  supported: boolean;
  connected: boolean;
  inputs: MidiPortInfo[];
  outputs: MidiPortInfo[];
  selectedOutputId: string | null;
  midiOutEnabled: boolean;
  lastMessage: string | null;
}

interface WebMidiMessageEvent {
  data: Uint8Array;
}

interface WebMidiInputPort {
  id: string;
  name?: string;
  manufacturer?: string;
  onmidimessage: ((e: WebMidiMessageEvent) => void) | null;
}

interface WebMidiOutputPort {
  id: string;
  name?: string;
  manufacturer?: string;
  send: (data: number[] | Uint8Array, timestamp?: number) => void;
}

interface WebMidiAccess {
  inputs: Map<string, WebMidiInputPort>;
  outputs: Map<string, WebMidiOutputPort>;
  onstatechange: (() => void) | null;
}

export interface MidiInCallbacks {
  onNoteOn: (midi: number, velocity: number, channel: number) => void;
  onControlChange: (cc: number, normalizedValue: number) => void;
  onStatusChange?: (snapshot: MidiHubSnapshot) => void;
}

// Standard General MIDI Percussion Map (Channel 10 -> 0-indexed channel 9)
const DRUM_GM_NOTES: Record<'kick' | 'snare' | 'hat' | 'perc', number> = {
  kick: 36,  // Acoustic Bass Drum
  snare: 38, // Acoustic Snare
  hat: 42,   // Closed Hi-Hat
  perc: 47,  // Low-Mid Tom / Conga
};

// Singer MIDI output channels (0-indexed: Ch 1 = Bass, Ch 2 = Melody, Ch 3 = Harmony)
const SINGER_MIDI_CHANNELS: Record<'bass' | 'melody' | 'harmony', number> = {
  bass: 0,
  melody: 1,
  harmony: 2,
};

/**
 * Full two-way WebMIDI Hub:
 * - MIDI In: hardware keyboards & DAWs (Note On + CC#1 Mod, CC#74 Cutoff, CC#71 Res, CC#72 Release)
 * - MIDI Out: streams live 4-drum (Ch 10) + 3-singer (Ch 1..3) notes + holonomy shifts to external synths/LMMS!
 */
export class WebMidiHub {
  private access: WebMidiAccess | null = null;
  private callbacks: MidiInCallbacks | null = null;
  private selectedOutputId: string | null = null;
  private midiOutEnabled = false;
  private lastMessage: string | null = null;
  private supported =
    typeof navigator !== 'undefined' &&
    typeof (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function';

  public getSnapshot(): MidiHubSnapshot {
    const inputs: MidiPortInfo[] = [];
    const outputs: MidiPortInfo[] = [];

    if (this.access) {
      this.access.inputs.forEach((p) => {
        inputs.push({
          id: p.id,
          name: p.name || 'MIDI Input',
          manufacturer: p.manufacturer || '',
        });
      });
      this.access.outputs.forEach((p) => {
        outputs.push({
          id: p.id,
          name: p.name || 'MIDI Output',
          manufacturer: p.manufacturer || '',
        });
      });
    }

    return {
      supported: this.supported,
      connected: this.access !== null,
      inputs,
      outputs,
      selectedOutputId: this.selectedOutputId,
      midiOutEnabled: this.midiOutEnabled,
      lastMessage: this.lastMessage,
    };
  }

  public async connect(callbacks: MidiInCallbacks): Promise<MidiHubSnapshot> {
    this.callbacks = callbacks;
    if (!this.supported) {
      this.lastMessage = 'WebMIDI unavailable in this browser';
      const snap = this.getSnapshot();
      callbacks.onStatusChange?.(snap);
      return snap;
    }

    try {
      const nav = navigator as unknown as {
        requestMIDIAccess: (opts?: { sysex?: boolean }) => Promise<WebMidiAccess>;
      };
      this.access = await nav.requestMIDIAccess({ sysex: false });
      this.bindInputs();
      if (!this.selectedOutputId) {
        const firstOut = this.access.outputs.values().next().value as WebMidiOutputPort | undefined;
        if (firstOut) this.selectedOutputId = firstOut.id;
      }
      this.access.onstatechange = () => {
        this.bindInputs();
        this.notify();
      };
      this.lastMessage =
        this.access.inputs.size > 0 || this.access.outputs.size > 0
          ? `${this.access.inputs.size} in · ${this.access.outputs.size} out`
          : 'WebMIDI ready (no ports detected)';
    } catch {
      this.lastMessage = 'WebMIDI permission declined';
    }

    const snap = this.getSnapshot();
    this.callbacks?.onStatusChange?.(snap);
    return snap;
  }

  private bindInputs(): void {
    if (!this.access) return;
    this.access.inputs.forEach((input) => {
      input.onmidimessage = (event) => {
        const data = event.data;
        if (!data || data.length < 2) return;
        const status = data[0];
        const cmd = status & 0xf0;
        const channel = status & 0x0f;
        const d1 = data[1];
        const d2 = data.length > 2 ? data[2] : 0;

        if (cmd === 0x90 && d2 > 0) {
          this.lastMessage = `In Ch${channel + 1} Note ${d1} vel ${d2}`;
          this.callbacks?.onNoteOn(d1, d2 / 127, channel);
          this.notify();
        } else if (cmd === 0xb0) {
          this.lastMessage = `In CC#${d1} = ${Math.round((d2 / 127) * 100)}%`;
          this.callbacks?.onControlChange(d1, d2 / 127);
          this.notify();
        }
      };
    });
  }

  public setOutputPort(id: string | null): void {
    this.selectedOutputId = id;
    this.notify();
  }

  public setMidiOutEnabled(enabled: boolean): void {
    this.midiOutEnabled = enabled;
    if (enabled && this.access && !this.selectedOutputId) {
      const first = this.access.outputs.values().next().value as WebMidiOutputPort | undefined;
      if (first) this.selectedOutputId = first.id;
    }
    this.notify();
  }

  public sendNote(midi: number, velocity: number, durationMs = 220, channel = 0): void {
    if (!this.midiOutEnabled || !this.access || !this.selectedOutputId) return;
    const output = this.access.outputs.get(this.selectedOutputId);
    if (!output) return;

    const ch = Math.max(0, Math.min(15, channel));
    const note = Math.max(0, Math.min(127, Math.round(midi)));
    const vel = Math.max(1, Math.min(127, Math.round(velocity * 127)));

    try {
      output.send([0x90 | ch, note, vel]);
      window.setTimeout(() => {
        try {
          output.send([0x80 | ch, note, 0]);
        } catch {
          // Ignore disconnected port during note off
        }
      }, Math.max(40, durationMs));
    } catch {
      // Ignore transient MIDI send failure
    }
  }

  public sendEnsembleRoleEvent(
    role: InstrumentRole,
    midiNote: number | null,
    velocity: number,
    durationMs: number
  ): void {
    if (!this.midiOutEnabled || !this.access || !this.selectedOutputId) return;
    if (role === 'kick' || role === 'snare' || role === 'hat' || role === 'perc') {
      this.sendNote(DRUM_GM_NOTES[role], velocity, Math.min(180, durationMs), 9); // Ch 10 GM Drums
    } else if (typeof midiNote === 'number') {
      this.sendNote(midiNote, velocity, durationMs, SINGER_MIDI_CHANNELS[role]);
    }
  }

  private notify(): void {
    this.callbacks?.onStatusChange?.(this.getSnapshot());
  }

  public dispose(): void {
    if (this.access) {
      this.access.onstatechange = null;
      this.access.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
    }
    this.access = null;
    this.callbacks = null;
  }
}
