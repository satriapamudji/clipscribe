const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  startSegmentCapture,
  startNativeLoopbackCapture,
  startWasapiDeviceLoopbackCapture,
  gracefulStop,
  concatSegmentsToMaster,
  getAudioDurationSeconds,
  testSource,
  listAudioSources,
  validateSourcesForCapture,
  checkBinary,
  detectAudioCapabilities
} = require("./ffmpeg");

const CHUNK_RE = /^chunk_(\d{5})\.wav$/i;

function nowIso() {
  return new Date().toISOString();
}

function safeTitle(value) {
  const text = String(value || "").trim() || "session";
  return text.replace(/[^a-z0-9-_ ]/gi, "").replace(/\s+/g, "-").toLowerCase();
}

function parseChunkIndex(fileName) {
  const match = fileName.match(CHUNK_RE);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

function listSegmentFiles(segmentsDir) {
  if (!fs.existsSync(segmentsDir)) {
    return [];
  }
  const entries = fs.readdirSync(segmentsDir);
  const chunkRows = entries
    .map((name) => ({ name, index: parseChunkIndex(name) }))
    .filter((row) => Number.isInteger(row.index))
    .sort((a, b) => a.index - b.index);
  return chunkRows.map((row) => ({
    index: row.index,
    file_path: path.join(segmentsDir, row.name)
  }));
}

function getFileSizeBytes(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch (_) {
    return 0;
  }
}

function createRecordingService({
  repo,
  settingsService,
  transcriptionWorker,
  eventSink
}) {
  const runtime = new Map();

  function emitSession(sessionId) {
    if (eventSink && typeof eventSink.onSessionUpdated === "function") {
      eventSink.onSessionUpdated(sessionId);
    }
  }

  function emitGlobal() {
    if (eventSink && typeof eventSink.onGlobalUpdated === "function") {
      eventSink.onGlobalUpdated();
    }
  }

  function ensureRuntime(session, segmentsDir) {
    let rt = runtime.get(session.id);
    if (!rt) {
      rt = {
        sessionId: session.id,
        sessionDir: session.session_dir,
        segmentsDir,
        nextChunkIndex: 0,
        nextChunkStartSec: Number(session.recorded_seconds || 0),
        ignoredChunkIndices: new Set(),
        captureProcess: null,
        pollTimer: null,
        selectedSources: session.selected_sources || [],
        accumulatedSeconds: Number(session.recorded_seconds || 0),
        recordingStartedAtMs:
          session.status === "recording" ? Date.now() : null
      };
      const existingChunks = repo.listSessionChunks(session.id);
      if (existingChunks.length > 0) {
        const lastChunk = existingChunks[existingChunks.length - 1];
        rt.nextChunkIndex = Number(lastChunk.chunk_index || 0) + 1;
        rt.nextChunkStartSec = Number(lastChunk.end_sec || rt.nextChunkStartSec || 0);
      }
      runtime.set(session.id, rt);
      return rt;
    }
    rt.sessionDir = session.session_dir;
    rt.segmentsDir = segmentsDir || rt.segmentsDir;
    rt.selectedSources = session.selected_sources || rt.selectedSources;
    rt.accumulatedSeconds = Number(session.recorded_seconds || rt.accumulatedSeconds || 0);
    rt.nextChunkStartSec = Math.max(
      Number(rt.nextChunkStartSec || 0),
      Number(session.recorded_seconds || 0)
    );
    if (session.status !== "recording") {
      rt.recordingStartedAtMs = null;
    } else if (!rt.recordingStartedAtMs) {
      rt.recordingStartedAtMs = Date.now();
    }
    return rt;
  }

  function getRuntimeRecordedSeconds(session, rt) {
    const base = Number(rt?.accumulatedSeconds ?? session?.recorded_seconds ?? 0);
    if (!rt || !rt.recordingStartedAtMs || session?.status !== "recording") {
      return base;
    }
    return base + Math.max(0, (Date.now() - rt.recordingStartedAtMs) / 1000);
  }

  function ingestFinalizedChunks(session, rt, includeLast = false) {
    const files = listSegmentFiles(rt.segmentsDir);
    if (files.length === 0) {
      return;
    }
    const highestIdx = files[files.length - 1].index;
    const cutoff = includeLast ? highestIdx : highestIdx - 1;
    for (const file of files) {
      if (file.index > cutoff) {
        continue;
      }
      const startSec = Number(rt.nextChunkStartSec || 0);
      const endSec = startSec + Number(session.chunk_seconds || 0);
      const fileSize = getFileSizeBytes(file.file_path);
      if (fileSize < 512) {
        rt.ignoredChunkIndices.add(file.index);
        rt.nextChunkIndex = Math.max(rt.nextChunkIndex, file.index + 1);
        rt.nextChunkStartSec = endSec;
        continue;
      }
      const existing = repo.upsertChunk({
        sessionId: session.id,
        chunkIndex: file.index,
        startSec,
        endSec,
        filePath: file.file_path
      });
      const chunkEndSec = Number(existing?.end_sec ?? endSec);
      rt.nextChunkStartSec = Math.max(startSec, chunkEndSec);
      if (existing.status === "queued") {
        transcriptionWorker.kick();
      }
      rt.nextChunkIndex = Math.max(rt.nextChunkIndex, file.index + 1);
    }
  }

  function reconcileLastChunkTiming(session, rt, endSec) {
    const safeEnd = Math.max(0, Number(endSec || 0));
    const chunks = repo.listSessionChunks(session.id);
    if (chunks.length === 0) {
      rt.nextChunkStartSec = safeEnd;
      return;
    }
    const lastChunk = chunks[chunks.length - 1];
    const startSec = Number(lastChunk.start_sec || 0);
    const clampedEndSec = Math.max(startSec, safeEnd);
    if (Math.abs(Number(lastChunk.end_sec || 0) - clampedEndSec) > 0.001) {
      repo.updateChunkTiming({
        chunkId: lastChunk.id,
        startSec,
        endSec: clampedEndSec
      });
    }
    rt.nextChunkIndex = Math.max(rt.nextChunkIndex, Number(lastChunk.chunk_index || 0) + 1);
    rt.nextChunkStartSec = clampedEndSec;
  }

  function startPoller(session) {
    const rt = runtime.get(session.id);
    if (!rt) {
      return;
    }
    if (rt.pollTimer) {
      clearInterval(rt.pollTimer);
    }
    rt.pollTimer = setInterval(() => {
      const latest = repo.getSession(session.id);
      if (!latest) {
        return;
      }
      const includeLast = latest.status !== "recording";
      ingestFinalizedChunks(latest, rt, includeLast);
      if (latest.status === "recording") {
        const liveSec = getRuntimeRecordedSeconds(latest, rt);
        const existingSec = Number(latest.recorded_seconds || 0);
        if (liveSec > existingSec + 0.35) {
          repo.updateSession({ id: latest.id, recordedSeconds: liveSec });
        }
      }
      emitSession(session.id);
    }, 1000);
  }

  function stopPoller(sessionId) {
    const rt = runtime.get(sessionId);
    if (!rt || !rt.pollTimer) {
      return;
    }
    clearInterval(rt.pollTimer);
    rt.pollTimer = null;
  }

  async function spawnCaptureForSession(sessionId) {
    const session = repo.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }
    const rt = runtime.get(sessionId);
    if (!rt) {
      throw new Error("Session runtime not initialized.");
    }
    if (!session.selected_sources || session.selected_sources.length === 0) {
      throw new Error("Select at least one audio source before recording.");
    }

    const settings = settingsService.getSettings();
    await validateSourcesForCapture(settings.ffmpeg_path, session.selected_sources);
    const selectedSources = session.selected_sources || [];
    const hasNativeLoopback = selectedSources.some(
      (source) => source?.format === "loopback-process"
    );
    const hasOutputDeviceLoopback = selectedSources.some(
      (source) => source?.format === "wasapi-loopback-device"
    );
    if ((hasNativeLoopback || hasOutputDeviceLoopback) && selectedSources.length > 1) {
      throw new Error(
        "Native loopback capture currently supports one selected source at a time."
      );
    }

    if (hasNativeLoopback) {
      const loopbackSource = selectedSources[0];
      const handle = await startNativeLoopbackCapture({
        ffmpegPath: settings.ffmpeg_path,
        processId: loopbackSource.input || loopbackSource.process_id,
        chunkSeconds: session.chunk_seconds,
        startIndex: rt.nextChunkIndex,
        segmentsDir: rt.segmentsDir
      });
      rt.captureProcess = handle;
      handle.process.once("exit", () => {
        rt.captureProcess = null;
      });
      return;
    }

    if (hasOutputDeviceLoopback) {
      const outputSource = selectedSources[0];
      const handle = await startWasapiDeviceLoopbackCapture({
        ffmpegPath: settings.ffmpeg_path,
        deviceId: outputSource.device_id || outputSource.input,
        sampleRate: outputSource.sample_rate || 48000,
        channels: outputSource.n_channels || 2,
        chunkSeconds: session.chunk_seconds,
        startIndex: rt.nextChunkIndex,
        segmentsDir: rt.segmentsDir
      });
      rt.captureProcess = handle;
      handle.process.once("exit", () => {
        rt.captureProcess = null;
      });
      return;
    }

    const child = startSegmentCapture({
      ffmpegPath: settings.ffmpeg_path,
      sources: selectedSources,
      chunkSeconds: session.chunk_seconds,
      startIndex: rt.nextChunkIndex,
      segmentsDir: rt.segmentsDir
    });
    rt.captureProcess = child;
    child.once("exit", () => {
      rt.captureProcess = null;
    });
  }

  async function stopCapture(sessionId) {
    const rt = runtime.get(sessionId);
    if (!rt || !rt.captureProcess) {
      return;
    }
    if (rt.captureProcess.stop) {
      await rt.captureProcess.stop();
    } else {
      await gracefulStop(rt.captureProcess);
    }
    rt.captureProcess = null;
  }

  function buildMasterPath(sessionDir) {
    return path.join(sessionDir, "master.wav");
  }

  function ensureNoActiveSession() {
    const active = repo.listActiveSessions();
    if (active.length > 0) {
      throw new Error("A session is already active. Stop it before starting a new one.");
    }
  }

  async function startSession({ folderId, title, chunkSeconds, selectedSources }) {
    ensureNoActiveSession();
    const settings = settingsService.getSettings();
    const defaultFolder = repo.ensureDefaultFolder();
    const sessionFolderId = folderId || defaultFolder.id;
    const effectiveChunkSeconds = Number.isInteger(chunkSeconds)
      ? chunkSeconds
      : settings.chunk_seconds;
    const effectiveSources =
      Array.isArray(selectedSources) && selectedSources.length > 0
        ? selectedSources
        : settings.default_sources || [];
    if (!Array.isArray(effectiveSources) || effectiveSources.length === 0) {
      throw new Error("Select at least one audio source before starting recording.");
    }

    const sessionId = crypto.randomUUID();
    const sessionDir = path.join(
      settings.storage_root,
      "sessions",
      `${sessionId}-${safeTitle(title || "session")}`
    );
    const segmentsDir = path.join(sessionDir, "segments");
    fs.mkdirSync(segmentsDir, { recursive: true });
    const session = repo.createSession({
      id: sessionId,
      folderId: sessionFolderId,
      title: title || "Untitled Session",
      chunkSeconds: effectiveChunkSeconds,
      sessionDir,
      selectedSources: effectiveSources
    });
    const rt = ensureRuntime(repo.getSession(session.id), segmentsDir);
    rt.nextChunkIndex = 0;
    try {
      await spawnCaptureForSession(session.id);
    } catch (error) {
      stopPoller(session.id);
      runtime.delete(session.id);
      repo.updateSession({
        id: session.id,
        status: "stopped",
        endedAt: nowIso()
      });
      throw error;
    }
    rt.accumulatedSeconds = 0;
    rt.nextChunkStartSec = 0;
    rt.recordingStartedAtMs = Date.now();
    startPoller(session);
    emitGlobal();
    emitSession(session.id);
    return repo.getSession(session.id);
  }

  async function pauseSession(sessionId) {
    const session = repo.getSession(sessionId);
    if (!session || session.status !== "recording") {
      throw new Error("Session is not currently recording.");
    }
    const rt = runtime.get(sessionId);
    if (!rt) {
      throw new Error("Missing session runtime.");
    }
    await stopCapture(sessionId);
    ingestFinalizedChunks(session, rt, true);
    const latest = repo.getSession(session.id) || session;
    const atSec = getRuntimeRecordedSeconds(latest, rt);
    reconcileLastChunkTiming(session, rt, atSec);
    rt.accumulatedSeconds = atSec;
    rt.recordingStartedAtMs = null;
    repo.addEvent(session.id, "pause", atSec);
    repo.updateSession({
      id: session.id,
      status: "paused",
      recordedSeconds: atSec
    });
    emitSession(session.id);
  }

  async function resumeSession(sessionId) {
    const session = repo.getSession(sessionId);
    if (!session || session.status !== "paused") {
      throw new Error("Session is not paused.");
    }
    const rt = runtime.get(sessionId);
    if (!rt) {
      throw new Error("Missing session runtime.");
    }
    const files = listSegmentFiles(rt.segmentsDir);
    rt.nextChunkIndex = files.length === 0 ? 0 : files[files.length - 1].index + 1;
    const atSec = Number(rt.accumulatedSeconds || session.recorded_seconds || 0);
    rt.nextChunkStartSec = atSec;
    await spawnCaptureForSession(sessionId);
    rt.recordingStartedAtMs = Date.now();
    repo.addEvent(session.id, "resume", atSec);
    repo.updateSession({
      id: session.id,
      status: "recording",
      recordedSeconds: atSec
    });
    emitSession(session.id);
  }

  async function changeSessionSources(sessionId, selectedSources) {
    if (!Array.isArray(selectedSources) || selectedSources.length === 0) {
      throw new Error("At least one source is required.");
    }
    const session = repo.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }
    const wasRecording = session.status === "recording";
    if (wasRecording) {
      await pauseSession(sessionId);
    }
    const current = repo.getSession(sessionId);
    const currentRt = runtime.get(sessionId);
    const atSec = Number(currentRt?.accumulatedSeconds || current.recorded_seconds || 0);
    repo.addEvent(current.id, "source_change", atSec, { selected_sources: selectedSources });
    repo.updateSession({
      id: current.id,
      selectedSources
    });
    emitSession(current.id);
    if (wasRecording) {
      await resumeSession(current.id);
    }
    return repo.getSession(current.id);
  }

  async function stopSession(sessionId) {
    const session = repo.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }
    const rt = runtime.get(sessionId);
    if (!rt) {
      throw new Error("Missing session runtime.");
    }
    const latestBeforeStop = repo.getSession(sessionId) || session;
    const runtimeSec = getRuntimeRecordedSeconds(latestBeforeStop, rt);
    rt.accumulatedSeconds = runtimeSec;
    rt.recordingStartedAtMs = null;
    await stopCapture(sessionId);
    ingestFinalizedChunks(session, rt, true);
    stopPoller(sessionId);

    const files = listSegmentFiles(rt.segmentsDir).map((row) => row.file_path);
    const masterPath = buildMasterPath(session.session_dir);
    const settings = settingsService.getSettings();
    if (files.length > 0) {
      await concatSegmentsToMaster(settings.ffmpeg_path, files, masterPath);
    }
    const duration = files.length
      ? await getAudioDurationSeconds(settings.ffprobe_path, masterPath)
      : 0;
    let finalSec = Number.isFinite(duration) && duration > 0 ? duration : runtimeSec;
    const latestAfterStop = repo.getSession(session.id);
    const storedSec = Number(latestAfterStop?.recorded_seconds || 0);
    if (storedSec > finalSec) {
      finalSec = storedSec;
    }
    reconcileLastChunkTiming(session, rt, finalSec);

    const masterSizeBytes = files.length > 0 ? getFileSizeBytes(masterPath) : 0;
    const hasUsableAudioPayload = masterSizeBytes >= 512 && finalSec > 0.15;
    if (files.length > 0 && !hasUsableAudioPayload) {
      repo.addEvent(session.id, "warning", finalSec, {
        code: "no_audio_payload",
        message:
          "No usable audio frames were captured from selected sources. Confirm source routing and run source Test while playback is active."
      });
    }

    repo.updateSession({
      id: session.id,
      status: "stopped",
      endedAt: nowIso(),
      audioMasterPath: files.length ? masterPath : null,
      recordedSeconds: finalSec
    });
    repo.addEvent(session.id, "stop", finalSec);
    runtime.delete(sessionId);
    emitSession(sessionId);
    emitGlobal();
  }

  function setSpeakerAlias(sessionId, speakerId, alias) {
    const session = repo.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }
    const parsedSpeakerId = Number.parseInt(String(speakerId), 10);
    if (!Number.isInteger(parsedSpeakerId) || parsedSpeakerId < 0) {
      throw new Error("speakerId must be a non-negative integer.");
    }
    const rt = runtime.get(sessionId);
    const atSec = rt
      ? getRuntimeRecordedSeconds(session, rt)
      : Number(session.recorded_seconds || 0);
    const normalizedAlias = String(alias || "").trim();
    repo.addEvent(sessionId, "speaker_alias", atSec, {
      speaker_id: parsedSpeakerId,
      alias: normalizedAlias || null
    });
    emitSession(sessionId);
    return {
      ok: true,
      sessionId,
      speakerId: parsedSpeakerId,
      alias: normalizedAlias || null
    };
  }

  function getSessionDetail(sessionId) {
    const session = repo.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }
    return {
      session,
      chunks: repo.listSessionChunks(sessionId),
      events: repo.listSessionEvents(sessionId)
    };
  }

  function listFoldersWithSessions() {
    const folders = repo.listFolders();
    return folders.map((folder) => ({
      ...folder,
      sessions: repo.listSessions(folder.id)
    }));
  }

  function moveSession(sessionId, folderId) {
    const moved = repo.moveSession(sessionId, folderId);
    emitGlobal();
    emitSession(sessionId);
    return moved;
  }

  function renameSession(sessionId, title) {
    const renamed = repo.renameSession(sessionId, title);
    emitGlobal();
    emitSession(sessionId);
    return renamed;
  }

  function deleteSession(sessionId) {
    const session = repo.getSession(sessionId);
    if (!session) {
      return;
    }
    if (session.status === "recording" || session.status === "paused") {
      throw new Error("Stop the session before deleting it.");
    }
    repo.deleteSession(sessionId);
    runtime.delete(sessionId);
    emitGlobal();
    emitSession(sessionId);
  }

  async function testAudioSource(source, sessionId = null) {
    const settings = settingsService.getSettings();
    let outputDir = path.join(settings.storage_root, "tests");
    if (sessionId) {
      const session = repo.getSession(sessionId);
      if (session) {
        outputDir = path.join(session.session_dir, "tests");
      }
    }
    fs.mkdirSync(outputDir, { recursive: true });
    const outPath = path.join(outputDir, `source-test-${Date.now()}.wav`);
    return testSource(settings.ffmpeg_path, settings.ffprobe_path, source, outPath);
  }

  async function listSources() {
    const settings = settingsService.getSettings();
    const payload = await listAudioSources(settings.ffmpeg_path);
    return payload.sources;
  }

  async function getRuntimeHealth() {
    const settings = settingsService.getSettings();
    const [ffmpegCheck, ffprobeCheck, capabilities, sourcePayload] = await Promise.all([
      checkBinary(settings.ffmpeg_path, ["-version"]),
      checkBinary(settings.ffprobe_path, ["-version"]),
      detectAudioCapabilities(settings.ffmpeg_path).catch(() => ({
        has_dshow: false,
        has_wasapi: false
      })),
      listAudioSources(settings.ffmpeg_path).catch(() => ({
        sources: [],
        capabilities: { has_dshow: false, has_wasapi: false }
      }))
    ]);

    return {
      ffmpeg_ok: ffmpegCheck.ok,
      ffprobe_ok: ffprobeCheck.ok,
      has_dshow: capabilities.has_dshow,
      has_wasapi: capabilities.has_wasapi,
      has_native_loopback: sourcePayload.capabilities?.has_native_loopback || false,
      has_wasapi_output_loopback:
        sourcePayload.capabilities?.has_wasapi_output_loopback || false,
      source_count: sourcePayload.sources.length
    };
  }

  function recoverInterruptedSessions() {
    // If app closed unexpectedly, mark stale active sessions as stopped.
    const active = repo.listActiveSessions();
    for (const session of active) {
      repo.addEvent(session.id, "interrupted", session.recorded_seconds || 0, {
        reason: "app_restart"
      });
      repo.updateSession({
        id: session.id,
        status: "stopped",
        endedAt: nowIso()
      });
    }
  }

  return {
    startSession,
    pauseSession,
    resumeSession,
    stopSession,
    setSpeakerAlias,
    changeSessionSources,
    getSessionDetail,
    listFoldersWithSessions,
    moveSession,
    renameSession,
    deleteSession,
    testAudioSource,
    listSources,
    getRuntimeHealth,
    recoverInterruptedSessions
  };
}

module.exports = {
  createRecordingService
};
