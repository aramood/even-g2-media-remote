package com.example.g2mediahelper

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class MediaNotificationListenerService : NotificationListenerService() {
  private val repository: MediaSessionRepository
    get() = (application as HelperApplication).mediaSessionRepository

  override fun onListenerConnected() {
    super.onListenerConnected()
    repository.updatePermissionAndRefresh()
  }

  override fun onListenerDisconnected() {
    super.onListenerDisconnected()
    repository.updatePermissionAndRefresh()
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    super.onNotificationPosted(sbn)
    repository.refreshSessions()
  }

  override fun onNotificationRemoved(sbn: StatusBarNotification?) {
    super.onNotificationRemoved(sbn)
    repository.refreshSessions()
  }
}
