package com.example.g2mediahelper

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle

class MainActivity : ComponentActivity() {
  private val repository: MediaSessionRepository
    get() = (application as HelperApplication).mediaSessionRepository

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    maybeRequestPostNotifications()
    LoopbackServerService.start(this)

    setContent {
      MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
          HelperScreen(
            repository = repository,
            onStartService = { LoopbackServerService.start(this) },
            onOpenNotificationSettings = { openNotificationListenerSettings() },
            onOpenBatterySettings = { openBatteryOptimizationSettings() },
            onRefresh = { repository.refreshSessions() },
          )
        }
      }
    }
  }

  private fun maybeRequestPostNotifications() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      return
    }

    if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED
    ) {
      return
    }

    ActivityCompat.requestPermissions(
      this,
      arrayOf(Manifest.permission.POST_NOTIFICATIONS),
      10,
    )
  }

  private fun openNotificationListenerSettings() {
    startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
  }

  private fun openBatteryOptimizationSettings() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      return
    }

    val powerManager = getSystemService(PowerManager::class.java)
    if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
      startActivity(
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:$packageName")
        },
      )
      return
    }

    startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
  }
}

@Composable
@OptIn(ExperimentalLayoutApi::class)
private fun HelperScreen(
  repository: MediaSessionRepository,
  onStartService: () -> Unit,
  onOpenNotificationSettings: () -> Unit,
  onOpenBatterySettings: () -> Unit,
  onRefresh: () -> Unit,
) {
  val snapshot by repository.snapshot.collectAsStateWithLifecycle()
  val serviceRunning by LoopbackServerService.runningState.collectAsStateWithLifecycle()

  Column(
    modifier = Modifier
      .fillMaxSize()
      .background(Color(0xFFF4EFE8))
      .padding(20.dp),
    verticalArrangement = Arrangement.spacedBy(16.dp),
  ) {
    Text(
      text = "G2 Media Helper",
      style = MaterialTheme.typography.headlineMedium,
      fontWeight = FontWeight.SemiBold,
    )
    Text(
      text = "Foreground bridge for http://127.0.0.1:28765 and ws://127.0.0.1:28765/v1/events",
      style = MaterialTheme.typography.bodyMedium,
      color = Color(0xFF5F564D),
    )

    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      StatusPill("Service", if (serviceRunning) "Running" else "Stopped", serviceRunning)
      StatusPill(
        "Notification access",
        if (snapshot.health.notificationPermission) "Granted" else "Missing",
        snapshot.health.notificationPermission,
      )
      StatusPill(
        "Session",
        if (snapshot.state.active) "Active" else "Idle",
        snapshot.state.active,
      )
    }

    Card(
      colors = CardDefaults.cardColors(containerColor = Color.White),
      shape = RoundedCornerShape(24.dp),
    ) {
      Column(
        modifier = Modifier.padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
      ) {
        Text("Current state", style = MaterialTheme.typography.titleMedium)
        Text("Status: ${snapshot.health.message}")
        Text("App: ${snapshot.state.sourceAppLabel.ifBlank { "-" }}")
        Text("Title: ${snapshot.state.title.ifBlank { "-" }}")
        Text("Subtitle: ${snapshot.state.subtitle.ifBlank { "-" }}")
        Text("Position: ${snapshot.state.positionMs} / ${snapshot.state.durationMs} ms")
        Text(
          "Controls: prev=${snapshot.state.canSkipPrev}, next=${snapshot.state.canSkipNext}, seek=${snapshot.state.canSeek}",
        )
        Text("Volume: ${snapshot.state.volumeStep} / ${snapshot.state.volumeMaxStep}")
      }
    }

    Card(
      colors = CardDefaults.cardColors(containerColor = Color(0xFF18120E)),
      shape = RoundedCornerShape(24.dp),
    ) {
      Column(
        modifier = Modifier.padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
      ) {
          Text(
            text = "Setup actions",
            style = MaterialTheme.typography.titleMedium,
            color = Color(0xFFF8EFE1),
          )
          Text(
            text = "The helper starts automatically when this app opens and after device reboot.",
            style = MaterialTheme.typography.bodyMedium,
            color = Color(0xFFD9CBBE),
          )
          FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = onStartService) {
              Text("Restart helper")
            }
          OutlinedButton(onClick = onOpenNotificationSettings) {
            Text("Notification access")
          }
          OutlinedButton(onClick = onOpenBatterySettings) {
            Text("Battery settings")
          }
          OutlinedButton(onClick = onRefresh) {
            Text("Refresh")
          }
        }
      }
    }

    Spacer(modifier = Modifier.height(8.dp))
    Box(
      modifier = Modifier.fillMaxWidth(),
      contentAlignment = Alignment.CenterStart,
    ) {
      Text(
        text = "USB is only needed for install. After that, the helper stays active and restarts after reboot unless Android force-stops the app.",
        color = Color(0xFF5F564D),
      )
    }
  }
}

@Composable
private fun StatusPill(label: String, value: String, positive: Boolean) {
  Row(
    modifier = Modifier
      .background(
        color = if (positive) Color(0xFFD9EED8) else Color(0xFFF3D7D3),
        shape = RoundedCornerShape(999.dp),
      )
      .padding(horizontal = 14.dp, vertical = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    Text(text = label, fontWeight = FontWeight.Medium)
    Text(text = value)
  }
}
