package com.example.g2mediahelper

import android.app.Application

class HelperApplication : Application() {
  lateinit var mediaSessionRepository: MediaSessionRepository
    private set

  override fun onCreate() {
    super.onCreate()
    mediaSessionRepository = MediaSessionRepository(this)
  }
}
