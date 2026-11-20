import { ClientToServerMessage, ServerToClientMessage } from '../shared/protocol';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

export interface RoomClientCallbacks {
  onStatus: (status: ConnectionStatus) => void;
  onMessage: (msg: ServerToClientMessage) => void;
}

export class RoomClient {
  private ws: WebSocket | null = null;
  private clientId: string;
  private callbacks: RoomClientCallbacks;
  private reconnectTimer: number | null = null;
  private closedByUser = false;
  private pendingQueue: ClientToServerMessage[] = [];
  private lastUpdateSentAt = 0;

  constructor(clientId: string, callbacks: RoomClientCallbacks) {
    this.clientId = clientId;
    this.callbacks = callbacks;
  }

  private getWebSocketUrl(): string {
    const partyHost = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_PARTYKIT_HOST;
    if (partyHost) {
      const protocol = partyHost.startsWith('localhost') ? 'ws' : 'wss';
      return `${protocol}://${partyHost.replace(/^https?:\/\//, '')}/ws/room`;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/room`;
  }

  public connect(): void {
    if (this.closedByUser) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.callbacks.onStatus('connecting');
    const url = this.getWebSocketUrl();

    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.callbacks.onStatus('connected');
        this.sendImmediate({ type: 'hello', clientId: this.clientId });
        // Flush any queued messages
        while (this.pendingQueue.length > 0) {
          const next = this.pendingQueue.shift();
          if (next) this.sendImmediate(next);
        }
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as ServerToClientMessage;
          this.callbacks.onMessage(parsed);
        } catch {
          // Ignore malformed packet
        }
      };

      ws.onclose = () => {
        this.ws = null;
        if (!this.closedByUser) {
          this.callbacks.onStatus('reconnecting');
          this.scheduleReconnect();
        }
      };

      ws.onerror = () => {
        // onclose will trigger reconnect cleanly
      };
    } catch {
      this.callbacks.onStatus('reconnecting');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1400);
  }

  public send(msg: ClientToServerMessage): void {
    // Throttle high-frequency position updates to ~20Hz
    if (msg.type === 'update' && !msg.brain && msg.bootAt === undefined) {
      const now = performance.now();
      if (now - this.lastUpdateSentAt < 50) return;
      this.lastUpdateSentAt = now;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendImmediate(msg);
    } else if (msg.type !== 'update') {
      // Buffer critical state mutations (spawn/abandon/remove) until reconnected
      if (this.pendingQueue.length < 32) {
        this.pendingQueue.push(msg);
      }
    }
  }

  private sendImmediate(msg: ClientToServerMessage): void {
    try {
      this.ws?.send(JSON.stringify(msg));
    } catch {
      // Ignore send errors on closing socket
    }
  }

  public close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
