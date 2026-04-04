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

## Commands

The current implementation supports:

- `toggle_play_pause`
- `skip_previous`
- `skip_next`
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
