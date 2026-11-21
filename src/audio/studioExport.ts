import {
  BeatDocument,
  SCALE_INTERVALS,
  isSingerRole,
} from '../shared/beatSchema';

// ==================== STANDARD MIDI FILE (SMF FORMAT 1) EXPORTER ====================

function writeVarLen(value: number): number[] {
  let v = Math.max(0, Math.floor(value));
  const bytes: number[] = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function writeU16(v: number): number[] {
  return [(v >> 8) & 0xff, v & 0xff];
}

function writeU32(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function asciiBytes(str: string): number[] {
  return Array.from(str).map((ch) => ch.charCodeAt(0) & 0x7f);
}

function buildMidiTrackChunk(events: Array<{ tick: number; data: number[] }>): number[] {
  events.sort((a, b) => a.tick - b.tick);
  const body: number[] = [];
  let prevTick = 0;
  for (const ev of events) {
    const delta = Math.max(0, ev.tick - prevTick);
    prevTick = ev.tick;
    body.push(...writeVarLen(delta), ...ev.data);
  }
  // End of Track meta event
  body.push(0x00, 0xff, 0x2f, 0x00);
  return [...asciiBytes('MTrk'), ...writeU32(body.length), ...body];
}

const DRUM_NOTE_MAP: Record<string, number> = {
  kick: 36,
  snare: 38,
  hat: 42,
  perc: 47,
};

/**
 * Generates a multi-track Standard MIDI File (.mid, Format 1, 480 PPQ)
 * exporting 8 bars of all active drum (Ch 10) & singer (Ch 1..3) marchers.
 */
export function buildStandardMidiFile(doc: BeatDocument, bars = 8): Uint8Array {
  const ppq = 480;
  const ticksPerStep16 = ppq / 4; // 120 ticks per sixteenth note
  const usPerQuarter = Math.round(60_000_000 / Math.max(60, Math.min(180, doc.bpm)));

  const tracks: number[][] = [];

  // Track 0: Conductor track (Tempo + Time Signature + Title)
  const titleBytes = asciiBytes(doc.title.slice(0, 40));
  const conductorEvents: Array<{ tick: number; data: number[] }> = [
    { tick: 0, data: [0xff, 0x03, titleBytes.length, ...titleBytes] },
    {
      tick: 0,
      data: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff],
    },
    { tick: 0, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] }, // 4/4
  ];
  tracks.push(buildMidiTrackChunk(conductorEvents));

  // One track per active marcher
  let singerTrackCounter = 0;
  for (const m of doc.marchers) {
    if (m.muted) continue;
    const isSinger = isSingerRole(m.role);
    const channel = isSinger ? singerTrackCounter++ % 9 : 9; // Ch 10 (index 9) for drums
    const nameBytes = asciiBytes(`${m.label} (${m.role}/${m.variant})`.slice(0, 40));
    const events: Array<{ tick: number; data: number[] }> = [
      { tick: 0, data: [0xff, 0x03, nameBytes.length, ...nameBytes] },
    ];

    const spec = SCALE_INTERVALS[doc.scale] ?? SCALE_INTERVALS['D-lydian'];

    for (let bar = 0; bar < bars; bar++) {
      for (let s = 0; s < 16; s++) {
        const velRaw = m.steps[s] ?? 0;
        if (velRaw <= 0.01) continue;

        const vel = Math.max(12, Math.min(127, Math.round(velRaw * m.gain * 112)));
        const startTick = (bar * 16 + s) * ticksPerStep16;
        const durTicks = isSinger
          ? m.role === 'harmony'
            ? ticksPerStep16 * 4
            : m.role === 'bass'
              ? ticksPerStep16 * 3
              : ticksPerStep16 * 2
          : Math.round(ticksPerStep16 * 0.85);

        let note: number;
        if (isSinger) {
          const explicit = m.notes?.[s];
          note =
            typeof explicit === 'number'
              ? explicit
              : spec.rootMidi +
                (m.role === 'bass' ? -12 : m.role === 'melody' ? 12 : 0) +
                spec.intervals[s % spec.intervals.length];
        } else {
          note = DRUM_NOTE_MAP[m.role] ?? 36;
        }

        events.push({ tick: startTick, data: [0x90 | channel, note, vel] });
        events.push({ tick: startTick + durTicks, data: [0x80 | channel, note, 0] });
      }
    }

    tracks.push(buildMidiTrackChunk(events));
  }

  const header = [
    ...asciiBytes('MThd'),
    ...writeU32(6),
    ...writeU16(1), // Format 1 (multi-track)
    ...writeU16(tracks.length),
    ...writeU16(ppq),
  ];

  const totalBytes = [...header, ...tracks.flat()];
  return new Uint8Array(totalBytes);
}

export function triggerFileDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadMidiFromBeat(doc: BeatDocument): string {
  const bytes = buildStandardMidiFile(doc, 8);
  const slug = doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'drei-stars';
  const filename = `${slug}-${doc.bpm}bpm.mid`;
  triggerFileDownload(new Blob([new Uint8Array(bytes)], { type: 'audio/midi' }), filename);
  return filename;
}

// ==================== STUDIO MUSIC-VIDEO RECORDER (CANVAS + MASTER AUDIO) ====================

export interface StudioRecorderState {
  isRecording: boolean;
  elapsedSec: number;
  lastSavedFilename: string | null;
  error: string | null;
}

export class StudioVideoRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private combinedStream: MediaStream | null = null;
  private startedAtMs = 0;
  private lastSavedFilename: string | null = null;
  private error: string | null = null;

  public getState(): StudioRecorderState {
    const isRecording = this.recorder !== null && this.recorder.state === 'recording';
    return {
      isRecording,
      elapsedSec: isRecording ? (performance.now() - this.startedAtMs) / 1000 : 0,
      lastSavedFilename: this.lastSavedFilename,
      error: this.error,
    };
  }

  public start(
    canvas: HTMLCanvasElement,
    audioStream: MediaStream | null,
    title: string,
    bpm: number,
    onDone?: (filename: string) => void
  ): boolean {
    if (this.recorder && this.recorder.state === 'recording') return true;
    this.error = null;

    if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
      this.error = 'MediaRecorder canvas capture unsupported in this browser.';
      return false;
    }

    try {
      const videoStream = canvas.captureStream(60);
      const tracks: MediaStreamTrack[] = [...videoStream.getVideoTracks()];
      if (audioStream) {
        tracks.push(...audioStream.getAudioTracks());
      }
      this.combinedStream = new MediaStream(tracks);

      const mimeCandidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
      ];
      const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';

      this.chunks = [];
      this.recorder = new MediaRecorder(
        this.combinedStream,
        mimeType
          ? { mimeType, videoBitsPerSecond: 6_500_000, audioBitsPerSecond: 192_000 }
          : { videoBitsPerSecond: 6_500_000 }
      );

      this.recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          this.chunks.push(ev.data);
        }
      };

      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'drei-stars';
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const filename = `${slug}-${bpm}bpm.${ext}`;

      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: mimeType || 'video/webm' });
        this.chunks = [];
        if (blob.size > 0) {
          triggerFileDownload(blob, filename);
          this.lastSavedFilename = filename;
          onDone?.(filename);
        }
        this.cleanupTracks();
      };

      this.startedAtMs = performance.now();
      this.recorder.start(250);
      return true;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Unable to start studio video capture.';
      this.cleanupTracks();
      return false;
    }
  }

  public stop(): void {
    if (this.recorder && this.recorder.state === 'recording') {
      this.recorder.stop();
    } else {
      this.cleanupTracks();
    }
  }

  private cleanupTracks(): void {
    if (this.combinedStream) {
      // Stop only video tracks created by captureStream (leave live audio destination intact)
      for (const t of this.combinedStream.getVideoTracks()) {
        t.stop();
      }
      this.combinedStream = null;
    }
    this.recorder = null;
  }

  public dispose(): void {
    this.stop();
  }
}
