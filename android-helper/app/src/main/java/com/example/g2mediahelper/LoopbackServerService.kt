package com.example.g2mediahelper

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class LoopbackServerService : Service() {
  private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private lateinit var repository: MediaSessionRepository
  private var bridgeServer: MediaBridgeServer? = null

  override fun onCreate() {
    super.onCreate()

    repository = (application as HelperApplication).mediaSessionRepository
    repository.start()
    repository.setServiceRunning(true)
    createNotificationChannel()
    startForeground(NOTIFICATION_ID, buildNotification())

    bridgeServer = MediaBridgeServer(repository).also { server ->
      server.start(SOCKET_READ_TIMEOUT, false)
    }

    runningState.value = true

    serviceScope.launch {
      repository.snapshot.collect { snapshot ->
        bridgeServer?.broadcastState(snapshot)
      }
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    repository.refreshSessions()
    return START_STICKY
  }

  override fun onDestroy() {
    runningState.value = false
    bridgeServer?.stop()
    bridgeServer = null
    repository.setServiceRunning(false)
    repository.stop()
    serviceScope.cancel()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun buildNotification() =
    NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(getString(R.string.helper_notification_title))
      .setContentText(getString(R.string.helper_notification_text))
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setContentIntent(
        PendingIntent.getActivity(
          this,
          0,
          Intent(this, MainActivity::class.java),
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        ),
      )
      .build()

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val manager = getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(
      CHANNEL_ID,
      getString(R.string.helper_channel_name),
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = getString(R.string.helper_channel_description)
    }
    manager.createNotificationChannel(channel)
  }

  companion object {
    private const val CHANNEL_ID = "g2-media-helper"
    private const val NOTIFICATION_ID = 1001
    private const val SOCKET_READ_TIMEOUT = 0

    val runningState = MutableStateFlow(false)

    fun start(context: Context) {
      val intent = Intent(context, LoopbackServerService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }
  }
}
