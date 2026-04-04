import {
  HELPER_HTTP_BASE,
  HELPER_WS_URL,
  type CommandName,
  type CommandResponse,
  type HealthResponse,
  type ServerEvent,
  type StateEnvelope,
} from './types';

async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 1500,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await work(controller.signal);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 1500,
): Promise<T> {
  return withTimeout(async (signal) => {
    const response = await fetch(`${HELPER_HTTP_BASE}${path}`, {
      ...init,
      signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }, timeoutMs);
}

export interface SocketCallbacks {
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
  onEvent: (event: ServerEvent) => void;
}

export class HelperClient {
  getHealth(timeoutMs = 1500): Promise<HealthResponse> {
    return requestJson<HealthResponse>('/v1/health', {}, timeoutMs);
  }

  getState(timeoutMs = 1500): Promise<StateEnvelope> {
    return requestJson<StateEnvelope>('/v1/state', {}, timeoutMs);
  }

  sendCommand(
    command: CommandName,
    value?: number,
    timeoutMs = 1500,
  ): Promise<CommandResponse> {
    return withTimeout(async (signal) => {
      const response = await fetch(`${HELPER_HTTP_BASE}/v1/command`, {
        method: 'POST',
        signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command, value }),
      });

      const text = await response.text();
      let payload: CommandResponse | null = null;
      try {
        payload = JSON.parse(text) as CommandResponse;
      } catch {
        payload = null;
      }

      if (!payload) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return payload;
    }, timeoutMs);
  }

  connect(callbacks: SocketCallbacks): () => void {
    const socket = new WebSocket(HELPER_WS_URL);
    let closedByClient = false;

    socket.addEventListener('open', () => {
      callbacks.onOpen?.();
    });

    socket.addEventListener('message', (event) => {
      try {
        callbacks.onEvent(JSON.parse(event.data) as ServerEvent);
      } catch {
        // Ignore malformed payloads so transient helper issues do not kill the app.
      }
    });

    socket.addEventListener('close', () => {
      if (!closedByClient) {
        callbacks.onClose?.();
      }
    });

    socket.addEventListener('error', (event) => {
      callbacks.onError?.(event);
    });

    return () => {
      closedByClient = true;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };
  }
}
