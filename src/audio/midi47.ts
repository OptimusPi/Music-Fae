import { midiToHue, midiToNoteName } from './soundEngine';

export type Midi47LayoutId = 'vmpk' | 'isomorphic' | 'chromatic';

export const MIDI47_LAYOUT_LABELS: Record<Midi47LayoutId, string> = {
  vmpk: 'Piano Rows',
  isomorphic: 'Harmonic Grid',
  chromatic: 'Note Order',
};

export interface PhysicalKeyDef {
  code: string;
  label: string;
  row: 0 | 1 | 2 | 3; // 0 = number row (13), 1 = Q row (13), 2 = A row (11), 3 = Z row (10)
  col: number;
}

/**
 * Exact 47-key ANSI alphanumeric QWERTY core:
 * Row 0: 13 keys (` 1 2 3 4 5 6 7 8 9 0 - =)
 * Row 1: 13 keys (q w e r t y u i o p [ ] \)
 * Row 2: 11 keys (a s d f g h j k l ; ')
 * Row 3: 10 keys (z x c v b n m , . /)
 * Total = 47 physical keys.
 */
export const ANSI_47_ROWS: PhysicalKeyDef[][] = [
  [
    { code: 'Backquote', label: '`', row: 0, col: 0 },
    { code: 'Digit1', label: '1', row: 0, col: 1 },
    { code: 'Digit2', label: '2', row: 0, col: 2 },
    { code: 'Digit3', label: '3', row: 0, col: 3 },
    { code: 'Digit4', label: '4', row: 0, col: 4 },
    { code: 'Digit5', label: '5', row: 0, col: 5 },
    { code: 'Digit6', label: '6', row: 0, col: 6 },
    { code: 'Digit7', label: '7', row: 0, col: 7 },
    { code: 'Digit8', label: '8', row: 0, col: 8 },
    { code: 'Digit9', label: '9', row: 0, col: 9 },
    { code: 'Digit0', label: '0', row: 0, col: 10 },
    { code: 'Minus', label: '-', row: 0, col: 11 },
    { code: 'Equal', label: '=', row: 0, col: 12 },
  ],
  [
    { code: 'KeyQ', label: 'q', row: 1, col: 0 },
    { code: 'KeyW', label: 'w', row: 1, col: 1 },
    { code: 'KeyE', label: 'e', row: 1, col: 2 },
    { code: 'KeyR', label: 'r', row: 1, col: 3 },
    { code: 'KeyT', label: 't', row: 1, col: 4 },
    { code: 'KeyY', label: 'y', row: 1, col: 5 },
    { code: 'KeyU', label: 'u', row: 1, col: 6 },
    { code: 'KeyI', label: 'i', row: 1, col: 7 },
    { code: 'KeyO', label: 'o', row: 1, col: 8 },
    { code: 'KeyP', label: 'p', row: 1, col: 9 },
    { code: 'BracketLeft', label: '[', row: 1, col: 10 },
    { code: 'BracketRight', label: ']', row: 1, col: 11 },
    { code: 'Backslash', label: '\\', row: 1, col: 12 },
  ],
  [
    { code: 'KeyA', label: 'a', row: 2, col: 0 },
    { code: 'KeyS', label: 's', row: 2, col: 1 },
    { code: 'KeyD', label: 'd', row: 2, col: 2 },
    { code: 'KeyF', label: 'f', row: 2, col: 3 },
    { code: 'KeyG', label: 'g', row: 2, col: 4 },
    { code: 'KeyH', label: 'h', row: 2, col: 5 },
    { code: 'KeyJ', label: 'j', row: 2, col: 6 },
    { code: 'KeyK', label: 'k', row: 2, col: 7 },
    { code: 'KeyL', label: 'l', row: 2, col: 8 },
    { code: 'Semicolon', label: ';', row: 2, col: 9 },
    { code: 'Quote', label: "'", row: 2, col: 10 },
  ],
  [
    { code: 'KeyZ', label: 'z', row: 3, col: 0 },
    { code: 'KeyX', label: 'x', row: 3, col: 1 },
    { code: 'KeyC', label: 'c', row: 3, col: 2 },
    { code: 'KeyV', label: 'v', row: 3, col: 3 },
    { code: 'KeyB', label: 'b', row: 3, col: 4 },
    { code: 'KeyN', label: 'n', row: 3, col: 5 },
    { code: 'KeyM', label: 'm', row: 3, col: 6 },
    { code: 'Comma', label: ',', row: 3, col: 7 },
    { code: 'Period', label: '.', row: 3, col: 8 },
    { code: 'Slash', label: '/', row: 3, col: 9 },
  ],
];

export const ALL_47_KEYS: PhysicalKeyDef[] = ANSI_47_ROWS.flat();

/**
 * Standard VMPK / LMMS 47-key dual-manual piano mapping:
 * - Bottom two rows (Z../ naturals + A..' accidentals/enharmonic extensions): C3..E4
 * - Top two rows (Q..\ naturals + `..= accidentals/enharmonic extensions): C4..A5
 * Every single one of the 47 physical keys emits a real musical MIDI note (zero dead keys!).
 */
const VMPK_MIDI_BY_CODE: Record<string, number> = {
  // Bottom manual naturals (Z..Slash -> C3..E4)
  KeyZ: 48, KeyX: 50, KeyC: 52, KeyV: 53, KeyB: 55,
  KeyN: 57, KeyM: 59, Comma: 60, Period: 62, Slash: 64,
  // Home row accidentals + extensions (A..Quote -> B2, C#3, D#3, E3, F#3, G#3, A#3, B3, C#4, D#4, F4)
  KeyA: 47, KeyS: 49, KeyD: 51, KeyF: 52, KeyG: 54,
  KeyH: 56, KeyJ: 58, KeyK: 59, KeyL: 61, Semicolon: 63, Quote: 65,
  // Upper manual naturals (Q..Backslash -> C4..A5)
  KeyQ: 60, KeyW: 62, KeyE: 64, KeyR: 65, KeyT: 67,
  KeyY: 69, KeyU: 71, KeyI: 72, KeyO: 74, KeyP: 76,
  BracketLeft: 77, BracketRight: 79, Backslash: 81,
  // Number row accidentals + extensions (`..= -> A#3, B3, C#4, D#4, E4, F#4, G#4, A#4, B4, C#5, D#5, F#5, G#5)
  Backquote: 58, Digit1: 59, Digit2: 61, Digit3: 63, Digit4: 64,
  Digit5: 66, Digit6: 68, Digit7: 70, Digit8: 71, Digit9: 73,
  Digit0: 75, Minus: 78, Equal: 80,
};

/**
 * 47-Key Continuous Chromatic Matrix (bottom-left Z = C2 [36] up to top-right = = A#5 [82]):
 * 47 unique semitones, almost 4 complete uninterrupted chromatic octaves.
 */
const CHROMATIC_ORDER: PhysicalKeyDef[] = [
  ...ANSI_47_ROWS[3],
  ...ANSI_47_ROWS[2],
  ...ANSI_47_ROWS[1],
  ...ANSI_47_ROWS[0],
];

const CHROMATIC_MIDI_BY_CODE: Record<string, number> = {};
CHROMATIC_ORDER.forEach((k, idx) => {
  CHROMATIC_MIDI_BY_CODE[k.code] = 36 + idx; // C2 (36) -> A#5 (82)
});

/**
 * 47-Key Wicki-Hayden Isomorphic Lattice:
 * - Moving +1 column right = +2 semitones (whole tone)
 * - Moving up 1 row (row 3 -> 2 -> 1 -> 0) = +5 semitones (perfect fourth; up-right = perfect fifth +7!)
 * Every chord shape and interval is translation-invariant across the entire 47-key surface.
 */
const ISOMORPHIC_MIDI_BY_CODE: Record<string, number> = {};
for (const k of ALL_47_KEYS) {
  const rowFromBottom = 3 - k.row; // 0..3
  // Center comfortably around C3..G5
  ISOMORPHIC_MIDI_BY_CODE[k.code] = 43 + rowFromBottom * 5 + k.col * 2;
}

const IS_BLACK_NOTE = new Set([1, 3, 6, 8, 10]);

export interface ResolvedKey47 {
  code: string;
  label: string;
  midi: number;
  noteName: string;
  isAccidental: boolean;
  hue: number;
}

export function resolveKey47(
  layout: Midi47LayoutId,
  code: string,
  octaveShift = 0
): ResolvedKey47 | null {
  const def = ALL_47_KEYS.find((k) => k.code === code);
  if (!def) return null;

  let baseMidi: number;
  if (layout === 'vmpk') {
    baseMidi = VMPK_MIDI_BY_CODE[code] ?? 60;
  } else if (layout === 'isomorphic') {
    baseMidi = ISOMORPHIC_MIDI_BY_CODE[code] ?? 60;
  } else {
    baseMidi = CHROMATIC_MIDI_BY_CODE[code] ?? 60;
  }

  const midi = Math.max(24, Math.min(108, baseMidi + octaveShift * 12));
  return {
    code: def.code,
    label: def.label,
    midi,
    noteName: midiToNoteName(midi),
    isAccidental: IS_BLACK_NOTE.has(((midi % 12) + 12) % 12),
    hue: midiToHue(midi),
  };
}

export function isAnsi47Code(code: string): boolean {
  return ALL_47_KEYS.some((k) => k.code === code);
}

/**
 * Optional native Web MIDI API bridge so external hardware MIDI controllers
 * seamlessly drive the same Zyn synth and center-stage cube head VFX.
 */
export function attachHardwareMidi(onNoteOn: (midi: number, velocity: number) => void): () => void {
  const nav = navigator as unknown as {
    requestMIDIAccess?: () => Promise<{
      inputs: Map<string, { onmidimessage: ((e: { data: Uint8Array }) => void) | null }>;
    }>;
  };
  if (typeof nav.requestMIDIAccess !== 'function') {
    return () => {};
  }

  let disposed = false;
  const boundInputs: Array<{ onmidimessage: ((e: { data: Uint8Array }) => void) | null }> = [];

  nav
    .requestMIDIAccess()
    .then((access) => {
      if (disposed) return;
      access.inputs.forEach((input) => {
        input.onmidimessage = (event) => {
          const [status, note, velocity] = event.data;
          const cmd = status & 0xf0;
          if (cmd === 0x90 && velocity > 0) {
            onNoteOn(note, velocity / 127);
          }
        };
        boundInputs.push(input);
      });
    })
    .catch(() => {
      // Hardware MIDI optional; ignore if unavailable or denied
    });

  return () => {
    disposed = true;
    for (const input of boundInputs) {
      input.onmidimessage = null;
    }
  };
}
