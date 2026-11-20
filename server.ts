import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  BEAT_DOCUMENT_JSON_SCHEMA,
  DEFAULT_BEAT_DOCUMENT,
  DEFAULT_BPM,
  MAX_BPM,
  MIN_BPM,
  buildCharactersFromBeatDocument,
  exportBeatDocumentFromCharacters,
} from './src/shared/beatSchema.ts';
import {
  CharacterState,
  ClientToServerMessage,
  MARCH_RING_BASE_RADIUS,
  ServerToClientMessage,
} from './src/shared/protocol.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const ROOM_ID = 'main-cube';
const MAX_ABANDONED = 48;

interface ClientMeta {
  clientId: string;
  activeCharId: string | null;
}

const characters = new Map<string, CharacterState>();
const clients = new Map<WebSocket, ClientMeta>();
let roomBpm = DEFAULT_BPM;
let roomScale = DEFAULT_BEAT_DOCUMENT.scale;
let roomTitle = DEFAULT_BEAT_DOCUMENT.title;

function seedInitialMarchers(): void {
  if (characters.size > 0) return;
  const seeded = buildCharactersFromBeatDocument(DEFAULT_BEAT_DOCUMENT, -5000);
  for (const ch of seeded) {
    characters.set(ch.id, ch);
  }
}

function send(ws: WebSocket, msg: ServerToClientMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg: ServerToClientMessage, exclude?: WebSocket): void {
  const payload = JSON.stringify(msg);
  for (const ws of clients.keys()) {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function enforceAbandonedCap(): void {
  const abandoned = Array.from(characters.values())
    .filter((c) => c.mode === 'abandoned')
    .sort((a, b) => a.bootAt - b.bootAt);

  while (abandoned.length > MAX_ABANDONED) {
    const oldest = abandoned.shift();
    if (oldest) {
      characters.delete(oldest.id);
      broadcast({ type: 'character:removed', id: oldest.id });
    }
  }
}

function abandonCharacterOnServer(id: string, patch?: {
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  orbitRadius?: number;
  orbitAngle?: number;
  orbitSpeed?: number;
  orbitDir?: 1 | -1;
}): void {
  const existing = characters.get(id);
  if (!existing) return;

  const x = patch?.x ?? existing.x;
  const z = patch?.z ?? existing.z;
  const angle = patch?.orbitAngle ?? Math.atan2(z, x);
  const radius = patch?.orbitRadius ?? Math.max(5.5, Math.min(10.6, MARCH_RING_BASE_RADIUS + (Math.random() - 0.5) * 2.2));
  const speed = patch?.orbitSpeed ?? (0.44 + Math.random() * 0.28);
  const dir: 1 | -1 = patch?.orbitDir ?? 1;

  existing.ownerId = null;
  existing.mode = 'abandoned';
  existing.x = x;
  existing.y = Math.max(0, patch?.y ?? existing.y);
  existing.z = z;
  existing.yaw = patch?.yaw ?? existing.yaw;
  existing.orbitRadius = radius;
  existing.orbitAngle = angle;
  existing.orbitSpeed = speed;
  existing.orbitDir = dir;
  existing.moving = true;

  broadcast({
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

  enforceAbandonedCap();
}

async function startServer(): Promise<void> {
  seedInitialMarchers();

  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      roomId: ROOM_ID,
      bpm: roomBpm,
      clients: clients.size,
      characters: characters.size,
    });
  });

  app.get('/api/beat/schema', (_req, res) => {
    res.json(BEAT_DOCUMENT_JSON_SCHEMA);
  });

  app.get('/api/beat', (_req, res) => {
    res.json(exportBeatDocumentFromCharacters(characters.values(), roomBpm, roomScale, roomTitle));
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws/room' });

  wss.on('connection', (ws) => {
    const meta: ClientMeta = {
      clientId: `anon-${Math.random().toString(36).slice(2, 8)}`,
      activeCharId: null,
    };
    clients.set(ws, meta);

    send(ws, {
      type: 'snapshot',
      snapshot: {
        roomId: ROOM_ID,
        serverTime: Date.now(),
        clientCount: clients.size,
        bpm: roomBpm,
        characters: Array.from(characters.values()),
      },
    });
    broadcast({ type: 'room:presence', clientCount: clients.size }, ws);

    ws.on('message', (raw) => {
      let msg: ClientToServerMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientToServerMessage;
      } catch {
        return;
      }

      if (msg.type === 'hello') {
        meta.clientId = msg.clientId;
        return;
      }

      if (msg.type === 'spawn') {
        const ch = msg.character;
        if (!ch || !ch.id) return;
        characters.set(ch.id, ch);
        meta.activeCharId = ch.id;
        broadcast({ type: 'character:spawned', character: ch }, ws);
        return;
      }

      if (msg.type === 'update') {
        const existing = characters.get(msg.id);
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

        broadcast(
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
        return;
      }

      if (msg.type === 'set_bpm') {
        const clamped = Math.round(Math.max(MIN_BPM, Math.min(MAX_BPM, Number(msg.bpm) || DEFAULT_BPM)));
        roomBpm = clamped;
        broadcast({ type: 'room:bpm', bpm: clamped }, ws);
        return;
      }

      if (msg.type === 'load_beat') {
        const clamped = Math.round(Math.max(MIN_BPM, Math.min(MAX_BPM, Number(msg.beat?.bpm) || DEFAULT_BPM)));
        roomBpm = clamped;
        roomScale = msg.beat?.scale ?? roomScale;
        roomTitle = msg.beat?.title ?? roomTitle;
        characters.clear();
        for (const ch of msg.characters ?? []) {
          characters.set(ch.id, ch);
        }
        broadcast(
          { type: 'room:beat_loaded', bpm: roomBpm, characters: Array.from(characters.values()) },
          ws
        );
        return;
      }

      if (msg.type === 'abandon') {
        if (meta.activeCharId === msg.id) {
          meta.activeCharId = null;
        }
        abandonCharacterOnServer(msg.id, {
          x: msg.x,
          y: msg.y,
          z: msg.z,
          yaw: msg.yaw,
          orbitRadius: msg.orbitRadius,
          orbitAngle: msg.orbitAngle,
          orbitSpeed: msg.orbitSpeed,
          orbitDir: msg.orbitDir,
        });
        return;
      }

      if (msg.type === 'toast') {
        const existing = characters.get(msg.id);
        if (existing) {
          existing.mode = 'toasted';
        }
        return;
      }

      if (msg.type === 'remove') {
        if (characters.delete(msg.id)) {
          if (meta.activeCharId === msg.id) meta.activeCharId = null;
          broadcast({ type: 'character:removed', id: msg.id });
        }
        return;
      }

      if (msg.type === 'clear_abandoned') {
        const remainingIds: string[] = [];
        for (const [id, ch] of characters.entries()) {
          if (ch.mode === 'abandoned') {
            characters.delete(id);
          } else {
            remainingIds.push(id);
          }
        }
        broadcast({ type: 'room:cleared_abandoned', remainingIds });
      }
    });

    ws.on('close', () => {
      const leaving = clients.get(ws);
      clients.delete(ws);
      // Any user who disconnects abandons their character to dance forever in the eternal circle!
      if (leaving?.activeCharId) {
        const ch = characters.get(leaving.activeCharId);
        if (ch && ch.mode !== 'toasted') {
          abandonCharacterOnServer(leaving.activeCharId);
        }
      }
      broadcast({ type: 'room:presence', clientCount: clients.size });
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Clear Cube Playground running on http://0.0.0.0:${PORT} (room: ${ROOM_ID})`);
  });
}

void startServer();
