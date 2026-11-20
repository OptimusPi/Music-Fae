/**
 * Cloudflare Workers + PartyKit Hibernation API Durable Object
 * Deploy effortlessly with: `npx wrangler deploy`
 *
 * Implements a single authoritative room ("main-cube") using WebSocket Hibernation
 * (`ctx.acceptWebSocket` + `webSocketMessage` + `webSocketClose` + `ctx.storage`)
 * so idle rooms cost zero compute while keeping every abandoned dancing cube alive forever!
 */

import {
  DEFAULT_BEAT_DOCUMENT,
  DEFAULT_BPM,
  MAX_BPM,
  MIN_BPM,
  buildCharactersFromBeatDocument,
} from '../src/shared/beatSchema';
import {
  CharacterState,
  ClientToServerMessage,
  MARCH_RING_BASE_RADIUS,
  ServerToClientMessage,
} from '../src/shared/protocol';

interface Env {
  PLAYGROUND_ROOM: DurableObjectNamespace;
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
}

interface Attachment {
  clientId: string;
  activeCharId: string | null;
}

const SINGLE_ROOM_ID = 'main-cube';
const STORAGE_KEY = 'cube_playground_characters_v2';
const BPM_STORAGE_KEY = 'cube_playground_bpm_v2';
const MAX_ABANDONED = 48;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Route all WebSocket upgrades and /ws/room traffic into the single hibernating room
    if (url.pathname === '/ws/room' || url.pathname.startsWith('/parties/')) {
      const id = env.PLAYGROUND_ROOM.idFromName(SINGLE_ROOM_ID);
      const stub = env.PLAYGROUND_ROOM.get(id);
      return stub.fetch(request);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Clear Cube Playground Worker ready. Connect via /ws/room.', { status: 200 });
  },
};

export class PlaygroundRoom implements DurableObject {
  static options = { hibernate: true };

  private state: DurableObjectState;
  private characters: Map<string, CharacterState> = new Map();
  private bpm = DEFAULT_BPM;
  private loaded = false;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const storedBpm = await this.state.storage.get<number>(BPM_STORAGE_KEY);
    if (typeof storedBpm === 'number' && Number.isFinite(storedBpm)) {
      this.bpm = Math.round(Math.max(MIN_BPM, Math.min(MAX_BPM, storedBpm)));
    }
    const stored = await this.state.storage.get<CharacterState[]>(STORAGE_KEY);
    if (stored && stored.length > 0 && stored[0].role && Array.isArray(stored[0].steps)) {
      for (const c of stored) {
        this.characters.set(c.id, c);
      }
    } else {
      const seeded = buildCharactersFromBeatDocument(DEFAULT_BEAT_DOCUMENT, -5000);
      for (const ch of seeded) {
        this.characters.set(ch.id, ch);
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.state.storage.put(STORAGE_KEY, Array.from(this.characters.values()));
  }

  private broadcast(msg: ServerToClientMessage, exclude?: WebSocket): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      if (ws !== exclude) {
        try {
          ws.send(payload);
        } catch {
          // Ignore closed socket
        }
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    await this.ensureLoaded();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const attachment: Attachment = {
      clientId: `cf-${Math.random().toString(36).slice(2, 8)}`,
      activeCharId: null,
    };

    // Cloudflare Hibernation API registration
    this.state.acceptWebSocket(server);
    server.serializeAttachment(attachment);

    const allSockets = this.state.getWebSockets();
    const snapshotMsg: ServerToClientMessage = {
      type: 'snapshot',
      snapshot: {
        roomId: SINGLE_ROOM_ID,
        serverTime: Date.now(),
        clientCount: allSockets.length,
        bpm: this.bpm,
        characters: Array.from(this.characters.values()),
      },
    };
    server.send(JSON.stringify(snapshotMsg));
    this.broadcast({ type: 'room:presence', clientCount: allSockets.length }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ensureLoaded();
    let msg: ClientToServerMessage;
    try {
      msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) as ClientToServerMessage;
    } catch {
      return;
    }

    const attachment = (ws.deserializeAttachment() as Attachment | null) ?? {
      clientId: 'anon',
      activeCharId: null,
    };

    if (msg.type === 'hello') {
      attachment.clientId = msg.clientId;
      ws.serializeAttachment(attachment);
      return;
    }

    if (msg.type === 'spawn') {
      this.characters.set(msg.character.id, msg.character);
      attachment.activeCharId = msg.character.id;
      ws.serializeAttachment(attachment);
      this.broadcast({ type: 'character:spawned', character: msg.character }, ws);
      await this.persist();
      return;
    }

    if (msg.type === 'update') {
      const existing = this.characters.get(msg.id);
      if (!existing) return;
      existing.x = msg.x;
      existing.y = msg.y;
      existing.z = msg.z;
      existing.vx = msg.vx;
      existing.vy = msg.vy;
      existing.vz = msg.vz;
      existing.yaw = msg.yaw;
      existing.mode = msg.mode;
      existing.moving = msg.moving;
      if (msg.bootAt !== undefined) existing.bootAt = msg.bootAt;
      if (msg.brain !== undefined) existing.brain = msg.brain;
      if (msg.role !== undefined) existing.role = msg.role;
      if (msg.variant !== undefined) existing.variant = msg.variant;
      if (msg.steps !== undefined) existing.steps = msg.steps;
      if (msg.notes !== undefined) existing.notes = msg.notes;
      if (msg.gain !== undefined) existing.gain = msg.gain;
      if (msg.muted !== undefined) existing.muted = msg.muted;

      this.broadcast(
        {
          type: 'character:updated',
          id: msg.id,
          x: msg.x,
          y: msg.y,
          z: msg.z,
          vx: msg.vx,
          vy: msg.vy,
          vz: msg.vz,
          yaw: msg.yaw,
          mode: msg.mode,
          moving: msg.moving,
          bootAt: msg.bootAt,
          brain: msg.brain,
          role: msg.role,
          variant: msg.variant,
          steps: msg.steps,
          notes: msg.notes,
          gain: msg.gain,
          muted: msg.muted,
        },
        ws
      );
      await this.persist();
      return;
    }

    if (msg.type === 'set_bpm') {
      this.bpm = Math.round(Math.max(MIN_BPM, Math.min(MAX_BPM, Number(msg.bpm) || DEFAULT_BPM)));
      await this.state.storage.put(BPM_STORAGE_KEY, this.bpm);
      this.broadcast({ type: 'room:bpm', bpm: this.bpm }, ws);
      return;
    }

    if (msg.type === 'load_beat') {
      this.bpm = Math.round(Math.max(MIN_BPM, Math.min(MAX_BPM, Number(msg.beat?.bpm) || DEFAULT_BPM)));
      await this.state.storage.put(BPM_STORAGE_KEY, this.bpm);
      this.characters.clear();
      for (const ch of msg.characters ?? []) {
        this.characters.set(ch.id, ch);
      }
      await this.persist();
      this.broadcast(
        { type: 'room:beat_loaded', bpm: this.bpm, characters: Array.from(this.characters.values()) },
        ws
      );
      return;
    }

    if (msg.type === 'abandon') {
      const existing = this.characters.get(msg.id);
      if (!existing) return;
      if (attachment.activeCharId === msg.id) {
        attachment.activeCharId = null;
        ws.serializeAttachment(attachment);
      }

      existing.ownerId = null;
      existing.mode = 'abandoned';
      existing.x = msg.x;
      existing.y = Math.max(0, msg.y);
      existing.z = msg.z;
      existing.yaw = msg.yaw;
      existing.orbitRadius = msg.orbitRadius;
      existing.orbitAngle = msg.orbitAngle;
      existing.orbitSpeed = msg.orbitSpeed;
      existing.orbitDir = msg.orbitDir;
      existing.moving = true;

      this.broadcast({
        type: 'character:abandoned',
        id: existing.id,
        x: existing.x,
        y: existing.y,
        z: existing.z,
        yaw: existing.yaw,
        orbitRadius: existing.orbitRadius,
        orbitAngle: existing.orbitAngle,
        orbitSpeed: existing.orbitSpeed,
        orbitDir: existing.orbitDir,
      });

      // Enforce cap so hibernation storage remains lean
      const abandoned = Array.from(this.characters.values())
        .filter((c) => c.mode === 'abandoned')
        .sort((a, b) => a.bootAt - b.bootAt);
      while (abandoned.length > MAX_ABANDONED) {
        const oldest = abandoned.shift();
        if (oldest) {
          this.characters.delete(oldest.id);
          this.broadcast({ type: 'character:removed', id: oldest.id });
        }
      }

      await this.persist();
      return;
    }

    if (msg.type === 'remove') {
      if (this.characters.delete(msg.id)) {
        this.broadcast({ type: 'character:removed', id: msg.id });
        await this.persist();
      }
      return;
    }

    if (msg.type === 'clear_abandoned') {
      const remainingIds: string[] = [];
      for (const [id, ch] of this.characters.entries()) {
        if (ch.mode === 'abandoned') {
          this.characters.delete(id);
        } else {
          remainingIds.push(id);
        }
      }
      this.broadcast({ type: 'room:cleared_abandoned', remainingIds });
      await this.persist();
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.ensureLoaded();
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (attachment?.activeCharId) {
      const ch = this.characters.get(attachment.activeCharId);
      if (ch && ch.mode !== 'toasted') {
        ch.ownerId = null;
        ch.mode = 'abandoned';
        ch.orbitAngle = Math.atan2(ch.z, ch.x);
        ch.orbitRadius = Math.max(5.5, Math.min(10.6, MARCH_RING_BASE_RADIUS));
        ch.moving = true;
        this.broadcast({
          type: 'character:abandoned',
          id: ch.id,
          x: ch.x,
          y: Math.max(0, ch.y),
          z: ch.z,
          yaw: ch.yaw,
          orbitRadius: ch.orbitRadius,
          orbitAngle: ch.orbitAngle,
          orbitSpeed: ch.orbitSpeed,
          orbitDir: ch.orbitDir,
        });
        await this.persist();
      }
    }
    const remaining = this.state.getWebSockets().filter((s) => s !== ws).length;
    this.broadcast({ type: 'room:presence', clientCount: remaining }, ws);
  }
}

// Minimal Cloudflare Workers type declarations so standard `tsc --noEmit` succeeds without extra @cloudflare/workers-types
interface DurableObject {
  fetch(request: Request): Promise<Response>;
}
interface DurableObjectId {
  toString(): string;
}
interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}
interface DurableObjectState {
  storage: DurableObjectStorage;
  acceptWebSocket(ws: WebSocket): void;
  getWebSockets(): WebSocket[];
}
declare const WebSocketPair: {
  new (): { 0: WebSocket; 1: WebSocket };
};
declare global {
  interface WebSocket {
    serializeAttachment(value: unknown): void;
    deserializeAttachment(): unknown;
  }
  interface ResponseInit {
    webSocket?: WebSocket;
  }
}
