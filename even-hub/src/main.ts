import './style.css';

import { GlassesUi } from './glassesUi';
import { HelperClient } from './helperClient';
import {
  DEFAULT_HEALTH,
  EMPTY_STATE,
  type ActionItem,
  type AppViewModel,
  type CommandName,
  type CommandResponse,
  type HealthResponse,
  type MediaState,
  type ServerEvent,
  type StateEnvelope,
} from './types';

const PROGRESS_TICK_MS = 500;
const HTTP_POLL_MS = 1000;
const WS_RECONNECT_MS = 3000;
const COMMAND_DEDUPE_MS = 150;
const PREVIEW_STORAGE_KEY = 'g2-media-remote-preview';
const PREVIEW_CHANNEL_NAME = 'g2-media-remote-preview';

interface PreviewOverrides {
  title: string;
  artist: string;
  elapsed: string;
  total: string;
}

function emptyPreviewOverrides(): PreviewOverrides {
  return {
    title: '',
    artist: '',
    elapsed: '',
    total: '',
  };
}

function parseDurationInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(':').map((part) => part.trim());
  if (parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts.map(Number);
    return (minutes * 60 + seconds) * 1000;
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts.map(Number);
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  return null;
}

function formatPreviewProgress(preview: PreviewOverrides, fallback: string): string {
  const elapsedMs = parseDurationInput(preview.elapsed);
  const totalMs = parseDurationInput(preview.total);

  if (elapsedMs !== null && totalMs !== null && totalMs > 0) {
    return `${buildProgressBar(elapsedMs, totalMs)} ${formatDuration(elapsedMs)} / ${formatDuration(totalMs)}`;
  }

  if (preview.elapsed.trim() || preview.total.trim()) {
    return `[----------------] ${preview.elapsed.trim() || '00:00'} / ${preview.total.trim() || '00:00'}`;
  }

  return fallback;
}

function readPreviewOverrides(): PreviewOverrides {
  const fallback = emptyPreviewOverrides();

  try {
    const params = new URLSearchParams(window.location.search);
    const queryState: PreviewOverrides = {
      title: params.get('sampleTitle') ?? '',
      artist: params.get('sampleArtist') ?? '',
      elapsed: params.get('sampleElapsed') ?? '',
      total: params.get('sampleTotal') ?? '',
    };

    if (Object.values(queryState).some((value) => value !== '')) {
      return queryState;
    }
  } catch {
    // Ignore URL parsing issues and fall back to local storage.
  }

  try {
    const raw = window.localStorage.getItem(PREVIEW_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<PreviewOverrides>;
    return {
      title: parsed.title ?? '',
      artist: parsed.artist ?? '',
      elapsed: parsed.elapsed ?? '',
      total: parsed.total ?? '',
    };
  } catch {
    return fallback;
  }
}

function formatDuration(totalMs: number): string {
  const safeMs = Math.max(0, totalMs);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function buildProgressBar(positionMs: number, durationMs: number, width = 16): string {
  if (durationMs <= 0) {
    return `[${'-'.repeat(width)}]`;
  }

  const ratio = Math.max(0, Math.min(1, positionMs / durationMs));
  const filled = Math.round(ratio * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
}

function isBridgeHostAvailable(): boolean {
  return typeof window !== 'undefined' && 'flutter_inappwebview' in window;
}

class MediaRemoteApp {
  private readonly helperClient = new HelperClient();
  private readonly glassesUi = new GlassesUi();
  private readonly appRoot = document.querySelector<HTMLDivElement>('#app');

  private mediaState: MediaState = { ...EMPTY_STATE };
  private healthState: HealthResponse = { ...DEFAULT_HEALTH };

  private helperReachable = false;
  private glassesBridgeReady = false;
  private wsConnected = false;

  private closeSocket: (() => void) | null = null;
  private pollTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private progressTimer: number | null = null;

  private lastActionId = '';
  private lastActionAt = 0;
  private commandMessage = 'Checking localhost bridge';
  private lastInputMessage = 'No glasses input yet';
  private previewOverrides: PreviewOverrides = readPreviewOverrides();
  private previewChannel: BroadcastChannel | null = null;
  private syncInFlight = false;
  private syncQueued = false;

  async start(): Promise<void> {
    if (!this.appRoot) {
      throw new Error('Missing #app root node');
    }

    this.appRoot.innerHTML = `
      <main class="shell">
        <section class="hero-card">
          <div>
            <p class="eyebrow">Even G2 / R1</p>
            <h1>Media Remote</h1>
            <p class="lede">Localhost bridge for Android media sessions.</p>
          </div>
          <div class="status-pills">
            <span class="pill" id="helper-pill">Helper offline</span>
            <span class="pill" id="bridge-pill">Bridge pending</span>
          </div>
        </section>
        <section class="grid">
          <article class="panel now-playing">
            <p class="panel-label">Now Playing</p>
            <h2 id="title">Connecting...</h2>
            <p class="subtitle" id="subtitle">Waiting for helper</p>
            <div class="progress-frame">
              <div class="progress-bar">
                <span class="progress-fill" id="progress-fill"></span>
              </div>
              <p class="progress-copy" id="progress-copy">[----------------] 00:00 / 00:00</p>
            </div>
          </article>
          <article class="panel helper-state">
            <p class="panel-label">Status</p>
            <div class="status-stack">
              <p id="header">Media Remote | Booting</p>
              <p id="status-copy">Checking helper reachability</p>
              <p id="package-copy">Package: -</p>
            </div>
          </article>
          <article class="panel actions">
            <div class="actions-head">
              <div>
              <p class="panel-label">Actions</p>
              <p class="actions-caption" id="input-debug">G2: No glasses input yet.</p>
              </div>
              <button class="outline-button" id="force-refresh" type="button">Refresh</button>
            </div>
            <div class="actions-grid" id="actions-grid"></div>
          </article>
          <article class="panel sample-panel">
            <div class="actions-head">
              <div>
                <p class="panel-label">Screenshot Sample</p>
                <p class="actions-caption">Fill these to override live metadata for screenshots.</p>
              </div>
              <button class="outline-button" id="clear-sample" type="button">Clear Sample</button>
            </div>
            <div class="sample-grid">
              <label class="sample-field">
                <span>Title</span>
                <input id="sample-title" type="text" placeholder="Sample track or video title" />
              </label>
              <label class="sample-field">
                <span>Artist</span>
                <input id="sample-artist" type="text" placeholder="Sample artist or channel" />
              </label>
              <label class="sample-field">
                <span>Elapsed</span>
                <input id="sample-elapsed" type="text" placeholder="00:42" />
              </label>
              <label class="sample-field">
                <span>Total</span>
                <input id="sample-total" type="text" placeholder="03:15" />
              </label>
            </div>
          </article>
        </section>
      </main>
    `;

    const refreshButton = document.querySelector<HTMLButtonElement>('#force-refresh');
    refreshButton?.addEventListener('click', () => {
      void this.refreshFromUi();
    });
    const clearSampleButton = document.querySelector<HTMLButtonElement>('#clear-sample');
    clearSampleButton?.addEventListener('click', () => {
      this.setPreviewOverrides(emptyPreviewOverrides(), true);
    });
    this.bindPreviewInputs();
    this.initPreviewChannel();

    this.render();
    this.startProgressTicker();

    this.glassesBridgeReady = await this.glassesUi.connect(
      (action) => {
        void this.handleAction(action, 'glasses');
      },
      (message) => {
        this.lastInputMessage = message;
        this.render();
      },
    );
    this.render();

    await this.runFeasibilityGate();
  }

  private startProgressTicker(): void {
    if (this.progressTimer !== null) {
      return;
    }

    this.progressTimer = window.setInterval(() => {
      if (!this.helperReachable || !this.mediaState.active) {
        return;
      }

      if (this.mediaState.isPlaying) {
        const nextPosition =
          this.mediaState.durationMs > 0
            ? Math.min(this.mediaState.positionMs + PROGRESS_TICK_MS, this.mediaState.durationMs)
            : this.mediaState.positionMs + PROGRESS_TICK_MS;

        this.mediaState = {
          ...this.mediaState,
          positionMs: nextPosition,
        };
      }

      this.render();
    }, PROGRESS_TICK_MS);
  }

  private bindPreviewInputs(): void {
    const titleInput = document.querySelector<HTMLInputElement>('#sample-title');
    const artistInput = document.querySelector<HTMLInputElement>('#sample-artist');
    const elapsedInput = document.querySelector<HTMLInputElement>('#sample-elapsed');
    const totalInput = document.querySelector<HTMLInputElement>('#sample-total');

    const bind = (
      input: HTMLInputElement | null,
      key: keyof PreviewOverrides,
    ) => {
      if (!input) {
        return;
      }

      input.value = this.previewOverrides[key];
      input.addEventListener('input', () => {
        this.setPreviewOverrides(
          {
            ...this.previewOverrides,
            [key]: input.value,
          },
          true,
        );
      });
    };

    bind(titleInput, 'title');
    bind(artistInput, 'artist');
    bind(elapsedInput, 'elapsed');
    bind(totalInput, 'total');
  }

  private initPreviewChannel(): void {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }

    this.previewChannel = new BroadcastChannel(PREVIEW_CHANNEL_NAME);
    this.previewChannel.onmessage = (event: MessageEvent<PreviewOverrides>) => {
      const next = event.data;
      if (!next) {
        return;
      }
      this.setPreviewOverrides(next, false);
    };
  }

  private setPreviewOverrides(next: PreviewOverrides, shouldBroadcast: boolean): void {
    this.previewOverrides = {
      title: next.title ?? '',
      artist: next.artist ?? '',
      elapsed: next.elapsed ?? '',
      total: next.total ?? '',
    };
    this.persistPreviewOverrides();
    this.syncPreviewInputs();
    if (shouldBroadcast) {
      this.previewChannel?.postMessage(this.previewOverrides);
    }
    this.render();
  }

  private persistPreviewOverrides(): void {
    try {
      window.localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(this.previewOverrides));
    } catch {
      // Ignore storage write errors.
    }

    try {
      const url = new URL(window.location.href);
      const entries: Array<[string, string]> = [
        ['sampleTitle', this.previewOverrides.title],
        ['sampleArtist', this.previewOverrides.artist],
        ['sampleElapsed', this.previewOverrides.elapsed],
        ['sampleTotal', this.previewOverrides.total],
      ];

      for (const [key, value] of entries) {
        if (value.trim()) {
          url.searchParams.set(key, value);
        } else {
          url.searchParams.delete(key);
        }
      }

      window.history.replaceState({}, '', url);
    } catch {
      // Ignore URL rewrite errors.
    }
  }

  private syncPreviewInputs(): void {
    const titleInput = document.querySelector<HTMLInputElement>('#sample-title');
    const artistInput = document.querySelector<HTMLInputElement>('#sample-artist');
    const elapsedInput = document.querySelector<HTMLInputElement>('#sample-elapsed');
    const totalInput = document.querySelector<HTMLInputElement>('#sample-total');

    if (titleInput && titleInput.value !== this.previewOverrides.title) {
      titleInput.value = this.previewOverrides.title;
    }
    if (artistInput && artistInput.value !== this.previewOverrides.artist) {
      artistInput.value = this.previewOverrides.artist;
    }
    if (elapsedInput && elapsedInput.value !== this.previewOverrides.elapsed) {
      elapsedInput.value = this.previewOverrides.elapsed;
    }
    if (totalInput && totalInput.value !== this.previewOverrides.total) {
      totalInput.value = this.previewOverrides.total;
    }
  }

  private async runFeasibilityGate(): Promise<void> {
    try {
      const health = await this.helperClient.getHealth();
      const envelope = await this.helperClient.getState();
      this.applyEnvelope({ ...envelope, health });
      this.helperReachable = true;
      this.commandMessage = health.message;
      this.stopPolling();
      this.render();
      this.connectSocket();
    } catch {
      this.markHelperUnreachable();
    }
  }

  private connectSocket(): void {
    this.closeSocket?.();
    this.closeSocket = this.helperClient.connect({
      onOpen: () => {
        this.wsConnected = true;
        this.stopPolling();
        this.clearReconnect();
        this.commandMessage = 'Live updates active';
        this.render();
      },
      onEvent: (event) => {
        this.applyServerEvent(event);
        this.helperReachable = true;
        this.wsConnected = true;
        this.render();
      },
      onClose: () => {
        this.handleSocketDrop();
      },
      onError: () => {
        this.handleSocketDrop();
      },
    });
  }

  private handleSocketDrop(): void {
    this.wsConnected = false;
    if (!this.helperReachable) {
      this.render();
      return;
    }

    this.commandMessage = 'WebSocket down, falling back to HTTP polling';
    this.startPolling();
    this.scheduleReconnect();
    this.render();
  }

  private startPolling(): void {
    if (this.pollTimer !== null) {
      return;
    }

    this.pollTimer = window.setInterval(() => {
      void this.pollOnce();
    }, HTTP_POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }

    this.reconnectTimer = window.setInterval(() => {
      if (this.wsConnected || !this.helperReachable) {
        return;
      }

      this.connectSocket();
    }, WS_RECONNECT_MS);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async pollOnce(): Promise<void> {
    try {
      const envelope = await this.helperClient.getState(1000);
      this.applyEnvelope(envelope);
      this.helperReachable = true;
      if (!this.wsConnected) {
        this.commandMessage = 'HTTP polling active';
      }
      this.render();
    } catch {
      try {
        const health = await this.helperClient.getHealth(1000);
        this.healthState = health;
        this.helperReachable = true;
        this.commandMessage = health.message;
        if (!health.activeSession) {
          this.mediaState = { ...EMPTY_STATE };
        }
        this.render();
      } catch {
        this.markHelperUnreachable();
      }
    }
  }

  private markHelperUnreachable(): void {
    this.helperReachable = false;
    this.wsConnected = false;
    this.stopPolling();
    this.clearReconnect();
    this.closeSocket?.();
    this.closeSocket = null;
    this.mediaState = { ...EMPTY_STATE };
    this.healthState = { ...DEFAULT_HEALTH, message: 'Helper unreachable' };
    this.commandMessage = 'Helper unreachable';
    this.render();
  }

  private normalizeState(nextState?: Partial<MediaState> | null): MediaState {
    return {
      ...EMPTY_STATE,
      ...this.mediaState,
      ...(nextState ?? {}),
    };
  }

  private normalizeHealth(nextHealth?: Partial<HealthResponse> | null): HealthResponse {
    return {
      ...DEFAULT_HEALTH,
      ...this.healthState,
      ...(nextHealth ?? {}),
    };
  }

  private applyEnvelope(envelope?: Partial<StateEnvelope> | null): void {
    this.mediaState = this.normalizeState(envelope?.state);
    this.healthState = this.normalizeHealth(envelope?.health);
  }

  private applyCommandResponse(response: CommandResponse): void {
    this.applyEnvelope({ state: response.state, health: response.health });
    this.helperReachable = true;
    this.commandMessage = response.message;
  }

  private applyServerEvent(event: ServerEvent): void {
    if (event.type === 'state') {
      this.applyEnvelope({ state: event.state, health: event.health });
      return;
    }

    this.applyEnvelope({ state: event.state, health: event.health });
    this.commandMessage = event.message;
  }

  private async refreshFromUi(): Promise<void> {
    this.commandMessage = 'Refreshing helper state';
    this.render();

    if (!this.helperReachable) {
      await this.runFeasibilityGate();
      return;
    }

    try {
      const response = await this.helperClient.sendCommand('refresh_session');
      this.applyCommandResponse(response);
      this.render();
    } catch {
      await this.runFeasibilityGate();
    }
  }

  private async handleAction(
    action: ActionItem,
    source: 'web' | 'glasses' = 'web',
  ): Promise<void> {
    if (action.disabled) {
      this.commandMessage = `${action.label} is unavailable`;
      this.render();
      return;
    }

    if (source === 'glasses') {
      const now = Date.now();
      if (this.lastActionId === action.id && now - this.lastActionAt < COMMAND_DEDUPE_MS) {
        return;
      }

      this.lastActionId = action.id;
      this.lastActionAt = now;
    }

    if (action.id === 'refresh') {
      await this.refreshFromUi();
      return;
    }

    try {
      const response = await this.sendAction(action.id);
      this.applyCommandResponse(response);
      this.render();
    } catch (error) {
      const recovered = await this.recoverAfterCommandFailure(error);
      if (!recovered) {
        this.markHelperUnreachable();
      }
    }
  }

  private async recoverAfterCommandFailure(error: unknown): Promise<boolean> {
    try {
      const envelope = await this.helperClient.getState(1000);
      this.applyEnvelope(envelope);
      this.helperReachable = true;
      this.commandMessage =
        error instanceof Error ? `Command failed: ${error.message}` : 'Command failed';
      this.render();
      return true;
    } catch {
      return false;
    }
  }

  private sendAction(actionId: ActionItem['id']): Promise<CommandResponse> {
    switch (actionId) {
      case 'toggle_play_pause':
      case 'skip_next':
      case 'skip_previous':
      case 'refresh_session':
        return this.helperClient.sendCommand(actionId as CommandName);
      case 'seek_back_10':
        return this.helperClient.sendCommand('seek_relative_ms', -10000);
      case 'seek_forward_10':
        return this.helperClient.sendCommand('seek_relative_ms', 10000);
      case 'volume_down':
        return this.helperClient.sendCommand('adjust_volume_steps', -1);
      case 'volume_up':
        return this.helperClient.sendCommand('adjust_volume_steps', 1);
      case 'refresh':
        return this.helperClient.sendCommand('refresh_session');
      default:
        throw new Error(`Unsupported action: ${String(actionId)}`);
    }
  }

  private buildActions(): ActionItem[] {
    const permissionMissing = !this.healthState.notificationPermission;
    const helperUnavailable = !this.helperReachable || permissionMissing;

    return [
      {
        id: 'toggle_play_pause',
        label: 'Play/Pause',
        disabled: helperUnavailable,
      },
      {
        id: 'skip_previous',
        label: 'Prev',
        disabled: helperUnavailable,
      },
      {
        id: 'skip_next',
        label: 'Next',
        disabled: helperUnavailable,
      },
      {
        id: 'seek_back_10',
        label: '-10s',
        disabled: helperUnavailable,
      },
      {
        id: 'seek_forward_10',
        label: '+10s',
        disabled: helperUnavailable,
      },
      {
        id: 'volume_down',
        label: 'Vol -',
        disabled: helperUnavailable,
      },
      {
        id: 'volume_up',
        label: 'Vol +',
        disabled: helperUnavailable,
      },
      {
        id: 'refresh',
        label: 'Refresh',
        disabled: false,
      },
    ];
  }

  private buildViewModel(): AppViewModel {
    const connectionLabel = !this.helperReachable
      ? 'Offline'
      : this.wsConnected
        ? 'Live'
        : 'Polling';

    const sourceLabel = this.mediaState.sourceAppLabel || 'Media Remote';
    const displayPosition = this.mediaState.active ? this.mediaState.positionMs : 0;
    const displayDuration = this.mediaState.active ? this.mediaState.durationMs : 0;

    const liveTitle = !this.helperReachable
      ? 'Helper unreachable'
      : this.mediaState.active
        ? this.mediaState.title || 'Unknown track'
        : 'No active session';

    let liveSubtitle = '';
    if (!this.helperReachable) {
      liveSubtitle = 'Start the helper app, then retry from G2 or this page.';
    } else if (!this.healthState.notificationPermission) {
      liveSubtitle = 'Grant Notification access in Android settings.';
    } else if (!this.mediaState.active) {
      liveSubtitle = 'Play something in Pulsar or another MediaSession app.';
    } else {
      liveSubtitle = this.mediaState.subtitle || this.mediaState.sourcePackage;
    }

    const title = this.previewOverrides.title.trim() || liveTitle;
    const subtitle = this.previewOverrides.artist.trim() || liveSubtitle;
    const progress = formatPreviewProgress(
      this.previewOverrides,
      `${buildProgressBar(displayPosition, displayDuration)} ${formatDuration(displayPosition)} / ${formatDuration(displayDuration)}`,
    );

    const status = !this.helperReachable
      ? 'Helper unreachable'
      : !this.healthState.notificationPermission
        ? 'Permission required'
        : !this.mediaState.active
          ? 'No active session'
          : this.commandMessage;

    return {
      header: `${sourceLabel} | ${connectionLabel}`,
      title,
      subtitle,
      progress,
      status,
      actions: this.buildActions(),
    };
  }

  private render(): void {
    const viewModel = this.buildViewModel();

    const helperPill = document.querySelector<HTMLElement>('#helper-pill');
    const bridgePill = document.querySelector<HTMLElement>('#bridge-pill');
    const title = document.querySelector<HTMLElement>('#title');
    const subtitle = document.querySelector<HTMLElement>('#subtitle');
    const header = document.querySelector<HTMLElement>('#header');
    const statusCopy = document.querySelector<HTMLElement>('#status-copy');
    const packageCopy = document.querySelector<HTMLElement>('#package-copy');
    const progressCopy = document.querySelector<HTMLElement>('#progress-copy');
    const progressFill = document.querySelector<HTMLElement>('#progress-fill');
    const actionsGrid = document.querySelector<HTMLElement>('#actions-grid');
    const inputDebug = document.querySelector<HTMLElement>('#input-debug');

    if (
      !helperPill ||
      !bridgePill ||
      !title ||
      !subtitle ||
      !header ||
      !statusCopy ||
      !packageCopy ||
      !progressCopy ||
      !progressFill ||
      !actionsGrid ||
      !inputDebug
    ) {
      return;
    }

    helperPill.textContent = this.helperReachable ? (this.wsConnected ? 'Helper live' : 'Helper polling') : 'Helper offline';
    helperPill.className = `pill ${this.helperReachable ? 'pill-live' : 'pill-offline'}`;

    bridgePill.textContent = this.glassesBridgeReady
      ? 'Bridge attached'
      : isBridgeHostAvailable()
        ? 'Bridge booting'
        : 'Browser preview';
    bridgePill.className = `pill ${this.glassesBridgeReady ? 'pill-live' : 'pill-neutral'}`;

    title.textContent = viewModel.title;
    subtitle.textContent = viewModel.subtitle;
    header.textContent = viewModel.header;
    statusCopy.textContent = `Status: ${viewModel.status}`;
    packageCopy.textContent = `Package: ${this.mediaState.sourcePackage || '-'}`;
    progressCopy.textContent = viewModel.progress;
    inputDebug.textContent = `G2: ${this.lastInputMessage}`;

    const previewElapsedMs = parseDurationInput(this.previewOverrides.elapsed);
    const previewTotalMs = parseDurationInput(this.previewOverrides.total);
    const ratio =
      previewElapsedMs !== null && previewTotalMs !== null && previewTotalMs > 0
        ? Math.max(0, Math.min(1, previewElapsedMs / previewTotalMs))
        : this.mediaState.durationMs > 0 && this.mediaState.active
          ? Math.max(0, Math.min(1, this.mediaState.positionMs / this.mediaState.durationMs))
          : 0;
    progressFill.style.width = `${Math.round(ratio * 100)}%`;

    actionsGrid.innerHTML = '';
    for (const action of viewModel.actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `action-button ${action.disabled ? 'is-disabled' : ''}`;
      button.textContent = action.label;
      button.disabled = action.disabled;
      button.addEventListener('click', () => {
        void this.handleAction(action, 'web');
      });
      actionsGrid.appendChild(button);
    }

    this.queueGlassesSync(viewModel);
  }

  private queueGlassesSync(viewModel: AppViewModel): void {
    if (!this.glassesBridgeReady) {
      return;
    }

    if (this.syncInFlight) {
      this.syncQueued = true;
      return;
    }

    this.syncInFlight = true;
    void this.glassesUi
      .sync(viewModel)
      .catch(() => {
        this.glassesBridgeReady = false;
      })
      .finally(() => {
        this.syncInFlight = false;
        if (this.syncQueued) {
          this.syncQueued = false;
          this.render();
        }
      });
  }
}

void new MediaRemoteApp().start();
