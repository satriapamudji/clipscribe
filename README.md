<div align="center">

# ClipScribe Desktop

Professional meeting capture for Windows with rolling Deepgram transcription, precise source control, and clean session organization.

![Platform](https://img.shields.io/badge/platform-Windows-0078D6)
![Electron](https://img.shields.io/badge/desktop-Electron-47848F)
![Node](https://img.shields.io/badge/node-20%2B-339933)
![FFmpeg](https://img.shields.io/badge/audio-FFmpeg-4CAF50)
![Deepgram](https://img.shields.io/badge/STT-Deepgram-0EA5E9)
![License](https://img.shields.io/badge/license-MIT-black)

</div>

ClipScribe is built for fast, reliable meeting workflows: capture audio, transcribe on a chunk cadence, and keep everything in one continuous, timestamped session timeline.

> [!WARNING]
> Your Deepgram API key is sensitive. Runtime data lives in `app-data/` and is intentionally gitignored. Never commit or share real keys.

## Contents

- [Highlights](#highlights)
- [Quick start](#quick-start)
- [How recording behaves](#how-recording-behaves)
- [CLI commands](#cli-commands)
- [Roadmap](#roadmap)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)

## Highlights

- Standalone desktop app experience with no browser dependency
- Rolling transcription appended to a single active session until stop
- Timestamped transcript chunks with direct copy actions
- Folder-based session history for fast retrieval and reuse
- Source selection for system output loopback (WASAPI), app loopback, system inputs, and microphones
- Built-in setup tooling: doctor checks, FFmpeg detect/install helpers, and native module repair
- Optional Deepgram usage breakdown view in settings

## Quick start

### 1) Install dependencies

```bash
npm install
```

### 2) Run health checks

```bash
npm run doctor
```

### 3) Ensure FFmpeg/FFprobe are configured

```bash
npm run ffmpeg:install
npm run ffmpeg:detect
```

### 4) Run setup TUI (optional, recommended)

```bash
npm run tui
```

### 5) Launch desktop app

```bash
npm start
```

> [!TIP]
> For global CLI usage without `npm run`, run `npm link` once in this repo, then use `clipscribe doctor` and `clipscribe tui` directly.

## How recording behaves

1. `Start` creates a new session.
2. Audio is captured continuously while active.
3. Every chunk interval, transcript is appended to that same session timeline.
4. `Pause` and `Resume` keep the same session.
5. `Stop` finalizes the session.
6. Next `Start` creates a brand-new session.

## CLI commands

Using npm scripts:

```bash
npm run clipscribe -- doctor
npm run clipscribe -- ffmpeg-detect
npm run clipscribe -- ffmpeg-install --yes
npm run clipscribe -- repair-native
npm run clipscribe -- tui
```

Using local script wrappers:

```powershell
.\scripts\clipscribe.ps1 doctor
```

```bat
scripts\clipscribe.cmd doctor
```

## Roadmap

- Multi-audio capture and mixing: select multiple sources in one session and blend into a single mastered recording stream.
- macOS support: native capture path and source picker for Apple hardware/audio stacks.
- Deeper transcript controls: richer editing and export flows for long-form meeting notes.

## Troubleshooting

### `better_sqlite3.node` ABI/version mismatch

```bash
npm run rebuild:native
```

### FFmpeg source detection/capture issues

```bash
npm run ffmpeg:detect
npm run doctor
```

In-app path: `Settings -> Setup Health -> Auto-Detect FFmpeg Paths`.

### App launches but behaves unexpectedly

Check startup/runtime log:

```powershell
Get-Content .\app-data\startup.log -Tail 200
```

## Project layout

```text
.
|-- scripts/
|   |-- clipscribe.cmd
|   `-- clipscribe.ps1
|-- src/
|   |-- cli/
|   |-- main/
|   `-- renderer/
|-- .gitattributes
|-- .gitignore
|-- README.md
|-- package-lock.json
`-- package.json
```

Internal docs are in `docs/internal/` and excluded from Git by default.
