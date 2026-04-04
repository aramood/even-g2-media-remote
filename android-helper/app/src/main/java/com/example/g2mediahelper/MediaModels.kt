package com.example.g2mediahelper

import kotlinx.serialization.Serializable

@Serializable
data class MediaState(
  val sourcePackage: String,
  val sourceAppLabel: String,
  val title: String,
  val subtitle: String,
  val isPlaying: Boolean,
  val positionMs: Long,
  val durationMs: Long,
  val canSkipPrev: Boolean,
  val canSkipNext: Boolean,
  val canSeek: Boolean,
  val volumeStep: Int,
  val volumeMaxStep: Int,
  val active: Boolean,
  val updatedElapsedRealtimeMs: Long,
)

@Serializable
data class HealthResponse(
  val ok: Boolean,
  val serviceRunning: Boolean,
  val notificationPermission: Boolean,
  val activeSession: Boolean,
  val status: String,
  val message: String,
)

@Serializable
data class StateEnvelope(
  val state: MediaState,
  val health: HealthResponse,
)

@Serializable
data class CommandRequest(
  val command: String,
  val value: Long? = null,
)

@Serializable
data class CommandResponse(
  val ok: Boolean,
  val command: String,
  val message: String,
  val state: MediaState,
  val health: HealthResponse,
)

@Serializable
sealed interface ServerEvent {
  val health: HealthResponse
  val state: MediaState
}

@Serializable
data class StateEvent(
  override val state: MediaState,
  override val health: HealthResponse,
  val type: String = "state",
) : ServerEvent

@Serializable
data class CommandResultEvent(
  val command: String,
  val ok: Boolean,
  val message: String,
  override val state: MediaState,
  override val health: HealthResponse,
  val type: String = "command_result",
) : ServerEvent

data class HelperSnapshot(
  val state: MediaState,
  val health: HealthResponse,
)

enum class HelperStatus(val wireValue: String) {
  Ok("ok"),
  NoActiveSession("no_active_session"),
  PermissionRequired("permission_required"),
}

data class CommandExecutionResult(
  val ok: Boolean,
  val message: String,
  val snapshot: HelperSnapshot,
)

fun emptyMediaState(
  volumeStep: Int = 0,
  volumeMaxStep: Int = 15,
): MediaState = MediaState(
  sourcePackage = "",
  sourceAppLabel = "",
  title = "",
  subtitle = "",
  isPlaying = false,
  positionMs = 0L,
  durationMs = 0L,
  canSkipPrev = false,
  canSkipNext = false,
  canSeek = false,
  volumeStep = volumeStep,
  volumeMaxStep = volumeMaxStep,
  active = false,
  updatedElapsedRealtimeMs = 0L,
)
