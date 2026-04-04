export const HELPER_HTTP_BASE = 'http://127.0.0.1:28765';
export const HELPER_WS_URL = 'ws://127.0.0.1:28765/v1/events';

export type HelperStatus = 'ok' | 'no_active_session' | 'permission_required';

export interface MediaState {
  sourcePackage: string;
  sourceAppLabel: string;
  title: string;
  subtitle: string;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  canSkipPrev: boolean;
  canSkipNext: boolean;
  canSeek: boolean;
  volumeStep: number;
  volumeMaxStep: number;
  active: boolean;
  updatedElapsedRealtimeMs: number;
}

export interface HealthResponse {
  ok: boolean;
  serviceRunning: boolean;
  notificationPermission: boolean;
  activeSession: boolean;
  status: HelperStatus;
  message: string;
}

export type CommandName =
  | 'toggle_play_pause'
  | 'skip_next'
  | 'skip_previous'
  | 'seek_relative_ms'
  | 'adjust_volume_steps'
  | 'refresh_session';

export interface CommandRequest {
  command: CommandName;
  value?: number;
}

export interface CommandResponse {
  ok: boolean;
  command: CommandName;
  message: string;
  state: MediaState;
  health: HealthResponse;
}

export interface StateEnvelope {
  state: MediaState;
  health: HealthResponse;
}

export interface StateEvent {
  type: 'state';
  state: MediaState;
  health: HealthResponse;
}

export interface CommandResultEvent {
  type: 'command_result';
  command: CommandName;
  ok: boolean;
  message: string;
  state: MediaState;
  health: HealthResponse;
}

export type ServerEvent = StateEvent | CommandResultEvent;

export interface ActionItem {
  id:
    | CommandName
    | 'seek_back_10'
    | 'seek_forward_10'
    | 'volume_down'
    | 'volume_up'
    | 'refresh';
  label: string;
  disabled: boolean;
}

export interface AppViewModel {
  header: string;
  title: string;
  subtitle: string;
  progress: string;
  status: string;
  actions: ActionItem[];
}

export const EMPTY_STATE: MediaState = {
  sourcePackage: '',
  sourceAppLabel: '',
  title: '',
  subtitle: '',
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  canSkipPrev: false,
  canSkipNext: false,
  canSeek: false,
  volumeStep: 0,
  volumeMaxStep: 15,
  active: false,
  updatedElapsedRealtimeMs: 0,
};

export const DEFAULT_HEALTH: HealthResponse = {
  ok: false,
  serviceRunning: false,
  notificationPermission: false,
  activeSession: false,
  status: 'permission_required',
  message: 'Permission required',
};
