package com.example.g2mediahelper

import android.content.ComponentName
import android.content.Context
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSession
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.SystemClock
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class MediaSessionRepository(context: Context) {
  private val appContext = context.applicationContext
  private val audioManager = appContext.getSystemService(AudioManager::class.java)
  private val mediaSessionManager = appContext.getSystemService(MediaSessionManager::class.java)
  private val listenerComponent = ComponentName(appContext, MediaNotificationListenerService::class.java)
  private val lock = Any()

  private val _snapshot = MutableStateFlow(buildSnapshot(controller = null))
  val snapshot: StateFlow<HelperSnapshot> = _snapshot.asStateFlow()

  private val controllerCallbacks = mutableMapOf<MediaSession.Token, MediaController.Callback>()
  private var trackedControllers = emptyMap<MediaSession.Token, MediaController>()
  private var selectedController: MediaController? = null
  private var serviceRunning: Boolean = false
  private var started: Boolean = false
  private var listenerRegistered: Boolean = false

  private val activeSessionsListener = MediaSessionManager.OnActiveSessionsChangedListener {
    refreshSessions()
  }

  fun start() {
    synchronized(lock) {
      if (started) {
        return
      }
      started = true
      registerActiveSessionsListener()
      refreshSessionsLocked()
    }
  }

  fun stop() {
    synchronized(lock) {
      if (listenerRegistered) {
        mediaSessionManager.removeOnActiveSessionsChangedListener(activeSessionsListener)
        listenerRegistered = false
      }
      controllerCallbacks.forEach { (token, callback) ->
        trackedControllers[token]?.unregisterCallback(callback)
      }
      controllerCallbacks.clear()
      trackedControllers = emptyMap()
      selectedController = null
    }
  }

  fun setServiceRunning(isRunning: Boolean) {
    synchronized(lock) {
      serviceRunning = isRunning
      _snapshot.value = buildSnapshot(selectedController)
    }
  }

  fun updatePermissionAndRefresh() {
    synchronized(lock) {
      registerActiveSessionsListener()
      refreshSessionsLocked()
    }
  }

  fun refreshSessions() {
    synchronized(lock) {
      refreshSessionsLocked()
    }
  }

  fun executeCommand(request: CommandRequest): CommandExecutionResult {
    synchronized(lock) {
      if (request.command == "refresh_session") {
        refreshSessionsLocked()
        return CommandExecutionResult(
          ok = true,
          message = _snapshot.value.health.message,
          snapshot = _snapshot.value,
        )
      }

      if (!hasNotificationAccess()) {
        val current = buildSnapshot(controller = null)
        _snapshot.value = current
        return CommandExecutionResult(
          ok = false,
          message = "Permission required",
          snapshot = current,
        )
      }

      val controller = selectedController ?: selectController(queryControllers()).also {
        selectedController = it
      }

      if (controller == null) {
        val current = buildSnapshot(controller = null)
        _snapshot.value = current
        return CommandExecutionResult(
          ok = false,
          message = "No active session",
          snapshot = current,
        )
      }

      val commandResult = when (request.command) {
        "toggle_play_pause" -> togglePlayPause(controller)
        "skip_next" -> skipNext(controller)
        "skip_previous" -> skipPrevious(controller)
        "seek_relative_ms" -> seekRelative(controller, request.value ?: 0L)
        "adjust_volume_steps" -> adjustVolume(request.value ?: 0L)
        else -> CommandExecutionResult(
          ok = false,
          message = "Unsupported command",
          snapshot = _snapshot.value,
        )
      }

      refreshSessionsLocked()
      return commandResult.copy(snapshot = _snapshot.value)
    }
  }

  private fun refreshSessionsLocked() {
    registerActiveSessionsListener()
    val controllers = queryControllers()
    syncCallbacks(controllers)
    selectedController = selectController(controllers)
    _snapshot.value = buildSnapshot(selectedController)
  }

  private fun registerActiveSessionsListener() {
    if (listenerRegistered) {
      mediaSessionManager.removeOnActiveSessionsChangedListener(activeSessionsListener)
      listenerRegistered = false
    }

    if (!hasNotificationAccess()) {
      return
    }

    try {
      mediaSessionManager.addOnActiveSessionsChangedListener(
        activeSessionsListener,
        listenerComponent,
      )
      listenerRegistered = true
    } catch (_: SecurityException) {
      listenerRegistered = false
    }
  }

  private fun syncCallbacks(controllers: List<MediaController>) {
    val nextControllers = controllers.associateBy { it.sessionToken }

    controllerCallbacks.keys
      .filterNot(nextControllers::containsKey)
      .forEach { token ->
        trackedControllers[token]?.unregisterCallback(controllerCallbacks.getValue(token))
        controllerCallbacks.remove(token)
      }

    nextControllers.forEach { (token, controller) ->
      if (controllerCallbacks.containsKey(token)) {
        return@forEach
      }

      val callback = object : MediaController.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackState?) {
          refreshSessions()
        }

        override fun onMetadataChanged(metadata: MediaMetadata?) {
          refreshSessions()
        }

        override fun onSessionDestroyed() {
          refreshSessions()
        }
      }
      controller.registerCallback(callback)
      controllerCallbacks[token] = callback
    }

    trackedControllers = nextControllers
  }

  private fun queryControllers(): List<MediaController> {
    if (!hasNotificationAccess()) {
      return emptyList()
    }

    return try {
      mediaSessionManager.getActiveSessions(listenerComponent).orEmpty()
    } catch (_: SecurityException) {
      emptyList()
    }
  }

  private fun selectController(controllers: List<MediaController>): MediaController? {
    return controllers
      .filter(::supportsPlayPause)
      .sortedWith(
        compareByDescending<MediaController> { isPlaying(it.playbackState) }
          .thenByDescending { controllerLastUpdated(it) },
      )
      .firstOrNull()
  }

  private fun supportsPlayPause(controller: MediaController): Boolean {
    val actions = controller.playbackState?.actions ?: 0L
    return actions and PlaybackState.ACTION_PLAY_PAUSE != 0L ||
      actions and PlaybackState.ACTION_PLAY != 0L ||
      actions and PlaybackState.ACTION_PAUSE != 0L
  }

  private fun controllerLastUpdated(controller: MediaController): Long {
    return controller.playbackState?.lastPositionUpdateTime ?: 0L
  }

  private fun isPlaying(playbackState: PlaybackState?): Boolean {
    return playbackState?.state == PlaybackState.STATE_PLAYING
  }

  private fun buildSnapshot(controller: MediaController?): HelperSnapshot {
    val volumeStep = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC)
    val volumeMax = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)

    if (!hasNotificationAccess()) {
      return HelperSnapshot(
        state = emptyMediaState(volumeStep, volumeMax),
        health = HealthResponse(
          ok = false,
          serviceRunning = serviceRunning,
          notificationPermission = false,
          activeSession = false,
          status = HelperStatus.PermissionRequired.wireValue,
          message = "Permission required",
        ),
      )
    }

    if (controller == null) {
      return HelperSnapshot(
        state = emptyMediaState(volumeStep, volumeMax),
        health = HealthResponse(
          ok = serviceRunning,
          serviceRunning = serviceRunning,
          notificationPermission = true,
          activeSession = false,
          status = HelperStatus.NoActiveSession.wireValue,
          message = "No active session",
        ),
      )
    }

    val playbackState = controller.playbackState
    val metadata = controller.metadata
    val durationMs = metadata?.getLong(MediaMetadata.METADATA_KEY_DURATION)?.coerceAtLeast(0L) ?: 0L
    val actions = playbackState?.actions ?: 0L
    val title = firstNonBlank(
      metadata?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE),
      metadata?.getString(MediaMetadata.METADATA_KEY_TITLE),
    )
    val subtitle = firstNonBlank(
      metadata?.getString(MediaMetadata.METADATA_KEY_ARTIST),
      metadata?.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE),
      metadata?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST),
      metadata?.getString(MediaMetadata.METADATA_KEY_ALBUM),
    )

    return HelperSnapshot(
      state = MediaState(
        sourcePackage = controller.packageName ?: "",
        sourceAppLabel = resolveAppLabel(controller.packageName),
        title = title,
        subtitle = subtitle,
        isPlaying = isPlaying(playbackState),
        positionMs = computePosition(playbackState, durationMs),
        durationMs = durationMs,
        canSkipPrev = actions and PlaybackState.ACTION_SKIP_TO_PREVIOUS != 0L,
        canSkipNext = actions and PlaybackState.ACTION_SKIP_TO_NEXT != 0L,
        canSeek = actions and PlaybackState.ACTION_SEEK_TO != 0L,
        volumeStep = volumeStep,
        volumeMaxStep = volumeMax,
        active = true,
        updatedElapsedRealtimeMs = SystemClock.elapsedRealtime(),
      ),
      health = HealthResponse(
        ok = serviceRunning,
        serviceRunning = serviceRunning,
        notificationPermission = true,
        activeSession = true,
        status = HelperStatus.Ok.wireValue,
        message = "Ready",
      ),
    )
  }

  private fun resolveAppLabel(packageName: String?): String {
    if (packageName.isNullOrBlank()) {
      return ""
    }

    return try {
      val applicationInfo = appContext.packageManager.getApplicationInfo(packageName, 0)
      appContext.packageManager.getApplicationLabel(applicationInfo).toString()
    } catch (_: Exception) {
      packageName
    }
  }

  private fun hasNotificationAccess(): Boolean {
    return NotificationManagerCompat.getEnabledListenerPackages(appContext)
      .contains(appContext.packageName)
  }

  private fun computePosition(playbackState: PlaybackState?, durationMs: Long): Long {
    if (playbackState == null) {
      return 0L
    }

    val basePosition = playbackState.position.coerceAtLeast(0L)
    val projected = if (playbackState.state == PlaybackState.STATE_PLAYING) {
      val elapsed = (SystemClock.elapsedRealtime() - playbackState.lastPositionUpdateTime).coerceAtLeast(0L)
      basePosition + (elapsed * playbackState.playbackSpeed).toLong()
    } else {
      basePosition
    }

    return if (durationMs > 0L) {
      projected.coerceIn(0L, durationMs)
    } else {
      projected.coerceAtLeast(0L)
    }
  }

  private fun firstNonBlank(vararg values: String?): String {
    return values.firstOrNull { !it.isNullOrBlank() }.orEmpty()
  }

  private fun togglePlayPause(controller: MediaController): CommandExecutionResult {
    val playbackState = controller.playbackState
    val transport = controller.transportControls
    val actions = playbackState?.actions ?: 0L

    return if (isPlaying(playbackState)) {
      if (actions and PlaybackState.ACTION_PAUSE == 0L &&
        actions and PlaybackState.ACTION_PLAY_PAUSE == 0L
      ) {
        CommandExecutionResult(false, "Pause unavailable", _snapshot.value)
      } else {
        transport.pause()
        CommandExecutionResult(true, "Playback paused", _snapshot.value)
      }
    } else {
      if (actions and PlaybackState.ACTION_PLAY == 0L &&
        actions and PlaybackState.ACTION_PLAY_PAUSE == 0L
      ) {
        CommandExecutionResult(false, "Play unavailable", _snapshot.value)
      } else {
        transport.play()
        CommandExecutionResult(true, "Playback started", _snapshot.value)
      }
    }
  }

  private fun skipNext(controller: MediaController): CommandExecutionResult {
    val actions = controller.playbackState?.actions ?: 0L
    return if (actions and PlaybackState.ACTION_SKIP_TO_NEXT == 0L) {
      CommandExecutionResult(false, "Next unavailable", _snapshot.value)
    } else {
      controller.transportControls.skipToNext()
      CommandExecutionResult(true, "Skipped to next", _snapshot.value)
    }
  }

  private fun skipPrevious(controller: MediaController): CommandExecutionResult {
    val actions = controller.playbackState?.actions ?: 0L
    return if (actions and PlaybackState.ACTION_SKIP_TO_PREVIOUS == 0L) {
      CommandExecutionResult(false, "Previous unavailable", _snapshot.value)
    } else {
      controller.transportControls.skipToPrevious()
      CommandExecutionResult(true, "Skipped to previous", _snapshot.value)
    }
  }

  private fun seekRelative(controller: MediaController, deltaMs: Long): CommandExecutionResult {
    val playbackState = controller.playbackState
    val actions = playbackState?.actions ?: 0L
    if (actions and PlaybackState.ACTION_SEEK_TO == 0L) {
      return CommandExecutionResult(false, "Seek unavailable", _snapshot.value)
    }

    val durationMs = controller.metadata?.getLong(MediaMetadata.METADATA_KEY_DURATION)?.coerceAtLeast(0L) ?: 0L
    val target = (computePosition(playbackState, durationMs) + deltaMs).coerceAtLeast(0L)
    val clampedTarget = if (durationMs > 0L) target.coerceAtMost(durationMs) else target
    controller.transportControls.seekTo(clampedTarget)
    val direction = if (deltaMs < 0L) "back" else "forward"
    return CommandExecutionResult(true, "Seeked $direction", _snapshot.value)
  }

  private fun adjustVolume(delta: Long): CommandExecutionResult {
    val direction = if (delta < 0L) {
      AudioManager.ADJUST_LOWER
    } else {
      AudioManager.ADJUST_RAISE
    }

    audioManager.adjustStreamVolume(
      AudioManager.STREAM_MUSIC,
      direction,
      AudioManager.FLAG_REMOVE_SOUND_AND_VIBRATE,
    )

    return CommandExecutionResult(true, "Volume adjusted", _snapshot.value)
  }
}
