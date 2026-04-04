# Even G2 Media Remote

This repository contains a working media remote for Even G2 / R1.

- `even-hub/`
  - Even Hub app built with Vite + TypeScript
  - shows title, artist, and playback progress on G2
  - accepts R1 input for `Play/Pause`, `Prev`, and `Next`
  - can be packaged as an `.ehpk` file for Even Hub
- `android-helper/`
  - Android companion app built with Kotlin + Compose
  - reads Android `MediaSession` state
  - exposes a loopback API on `127.0.0.1:28765`
  - survives USB disconnect and auto-recovers after device reboot

## Download

Latest release:

- [GitHub Releases](https://github.com/aramood/even-g2-media-remote/releases/latest)

Release assets:

- `G2MediaRemote.ehpk`
- `app-release.apk`

## Screenshot

Actual capture from Even G2 while running this tool:

![Even G2 live screenshot](docs/images/g2-live-screenshot.png)

## What It Does

The Even Hub app talks to a local Android helper app running on the same phone.

The helper app provides:

- `GET /v1/health`
- `GET /v1/state`
- `POST /v1/command`
- `ws://127.0.0.1:28765/v1/events`

The Even Hub app uses that local bridge to:

- display the current title
- display the artist / channel name
- display playback progress
- send media control commands from G2 / R1

## Controls

Current controls exposed on G2 / R1:

- `toggle_play_pause`
- `skip_previous`
- `skip_next`

Additional commands currently supported by the Android helper API, but not exposed on the main G2 / R1 UI:

- `seek_relative_ms`
- `adjust_volume_steps`
- `refresh_session`

## Repository Layout

```text
.
|-- android-helper/
|-- even-hub/
`-- README.md
```

## Local Development

### Even Hub app

```powershell
cd even-hub
npm install
npm run dev
```

Useful scripts:

- `npm run qr`
- `npm run pack`
- `npm run sim`
- `npm run sim:glow`

### Android helper

Open `android-helper/` in Android Studio and run the `app` target on a real Android device.

Required device setup:

- allow notification access
- allow foreground service operation
- allow battery optimization exclusion if needed

## Installation

### Android helper APK

1. Download `app-release.apk` from the latest release.
2. Install it on your Android phone.
3. If Android blocks the install, allow installs from your browser or file manager.
4. Open the helper app once after installation.
5. Grant notification access when prompted.
6. Allow the helper to keep running in the background if your device asks.
7. Confirm the persistent helper notification appears.

### Even Hub package

1. Download `G2MediaRemote.ehpk` from the latest release.
2. Open the Even Hub developer site and upload the `.ehpk` file to your project.
3. Sync the project to your phone.
4. Launch the Hub app from Even G2 / R1.

### First-time check

After both parts are installed:

1. Start playback in YouTube or a music app.
2. Make sure the Android helper is running.
3. Open the Hub app on G2.
4. Confirm title, artist, and playback controls are visible.

## Packaging

Build the Even Hub package:

```powershell
cd even-hub
npm run pack
```

This generates:

- `even-hub/G2MediaRemote.ehpk`

## Notes

- The helper app currently uses a localhost bridge for personal / experimental use.
- Public distribution of the Android helper should add authentication to the local API before wider release.
- The Android helper APK and the Even Hub package are distributed separately.
