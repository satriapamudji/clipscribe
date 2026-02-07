# ClipScribe Desktop

Standalone desktop app for meeting capture on Windows: select audio sources, record continuously, auto-transcribe in chunks, and keep everything organized by folders/sessions.

## Why ClipScribe

- Fast capture workflow for meetings/calls.
- Rolling transcription into a single session document.
- Per-chunk timestamps and copy actions.
- Folder-based session organization.
- Native Windows source options: system output loopback, app loopback, microphones.

## Core Behavior

1. `Start` creates a new session.
2. During recording, chunks are transcribed and appended to the same transcript timeline.
3. `Pause` and `Resume` stay in the same session.
4. `Stop` finalizes that session.
5. A new `Start` always creates a new session.

## Tech Stack

- Electron desktop shell
- SQLite (`better-sqlite3`) for metadata
- FFmpeg/FFprobe for capture/chunk processing
- Deepgram STT (`nova-3` default)
- Windows capture helpers: `audify`, `application-loopback`

## Quick Start

### 1) Install dependencies

```bash
npm install
```

### 2) Run health checks

```bash
npm run doctor
```

### 3) Install or detect FFmpeg

```bash
npm run ffmpeg:install
npm run ffmpeg:detect
```

### 4) Open guided setup TUI

```bash
npm run tui
```

### 5) Launch desktop app

```bash
npm start
```

## CLI Usage

Use npm scripts:

```bash
npm run clipscribe -- doctor
npm run clipscribe -- ffmpeg-detect
npm run clipscribe -- repair-native
npm run clipscribe -- tui
```

Use scripts directly:

```powershell
.\scripts\clipscribe.ps1 doctor
```

### Want `clipscribe ...` without `./`?

Install linked CLI once from this repo:

```bash
npm link
```

Then run:

```bash
clipscribe doctor
clipscribe tui
```

## Data, Privacy, and Security

- Local runtime state is stored in `app-data/` (sessions, chunks, sqlite, logs, settings).
- `app-data/` is git-ignored to prevent accidental secret/audio commits.
- Deepgram API key is currently stored in local settings JSON for MVP behavior.
- Never commit real API keys; rotate immediately if exposed.

## Project Layout

```text
.
|-- scripts/
|   |-- clipscribe.cmd
|   `-- clipscribe.ps1
|-- src/
|   |-- cli/
|   |-- main/
|   `-- renderer/
|-- .gitignore
|-- .gitattributes
|-- README.md
`-- package.json
```

## Troubleshooting

### Native module ABI mismatch (`better-sqlite3.node`)

```bash
npm run rebuild:native
```

### FFmpeg source issues

- Run `npm run ffmpeg:detect`.
- In app, use Setup Health -> Auto-Detect FFmpeg Paths.
- Confirm your FFmpeg build supports the source type you selected.

### App does not open but logs show startup completed

Check runtime logs:

```powershell
Get-Content .\app-data\startup.log -Tail 200
```

## Docs

- Internal docs are stored under `docs/internal/` and excluded from Git by default.

## Git-Ready Checklist

1. Confirm `.gitignore` is present and includes `app-data/`.
2. Ensure no real keys are in tracked files.
3. Initialize repo:

```bash
git init
git add .
git status
```

4. Verify no runtime audio/db/log files are staged.

