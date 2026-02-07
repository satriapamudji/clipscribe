const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

let loopbackModulePromise = null;
const AUDIFY_HELPER_PATH = path.join(__dirname, "audify-helper.js");

function getLoopbackModule() {
  if (!loopbackModulePromise) {
    loopbackModulePromise = import("application-loopback").catch(() => null);
  }
  return loopbackModulePromise;
}

function resolveNodeCommand() {
  const candidates = [
    process.env.CLIPSCRIBE_NODE_PATH,
    process.env.npm_node_execpath,
    "node"
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (candidate === "node") {
      return candidate;
    }
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_) {
      // ignore
    }
  }
  return "node";
}

function runNodeHelperCollect(args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveNodeCommand(), [AUDIFY_HELPER_PATH, ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch (_) {
        // ignore
      }
      reject(new Error(`Node helper timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (buf) => {
      stdout += String(buf);
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

function startNodeHelperStream(args, onStderr) {
  const child = spawn(resolveNodeCommand(), [AUDIFY_HELPER_PATH, ...args], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (onStderr) {
    child.stderr.on("data", (buf) => onStderr(String(buf)));
  }
  return child;
}

async function checkAudifyHelper() {
  const result = await runNodeHelperCollect(["check"], 8000).catch((error) => ({
    code: 1,
    stdout: "",
    stderr: String(error?.message || error)
  }));
  if (result.code !== 0) {
    return {
      ok: false,
      error: result.stderr || "audify helper check failed"
    };
  }
  return { ok: true };
}

async function listWasapiOutputDevicesViaHelper() {
  const result = await runNodeHelperCollect(["list"], 10000).catch((error) => ({
    code: 1,
    stdout: "",
    stderr: String(error?.message || error)
  }));
  if (result.code !== 0) {
    return {
      ok: false,
      devices: [],
      error: result.stderr || "audify helper list failed"
    };
  }
  try {
    const parsed = JSON.parse(result.stdout || "{}");
    const rows = Array.isArray(parsed?.devices) ? parsed.devices : [];
    return {
      ok: true,
      devices: rows
    };
  } catch (_) {
    return {
      ok: false,
      devices: [],
      error: "audify helper returned invalid JSON"
    };
  }
}

function normalizeInput(source) {
  if (!source || !source.input) {
    throw new Error("Invalid source configuration: missing input.");
  }
  if (source.input.startsWith("audio=")) {
    return source.input;
  }
  return `audio=${source.input}`;
}

function buildInputArgs(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("At least one source must be selected.");
  }
  const args = [];
  for (const source of sources) {
    const format = source.format || (source.kind === "system" ? "wasapi" : "dshow");
    args.push("-f", format, "-i", normalizeInput(source));
  }
  return args;
}

function buildMixArgs(sources) {
  if (sources.length === 1) {
    return ["-map", "0:a"];
  }
  const inputs = sources.map((_, idx) => `[${idx}:a]`).join("");
  const filter = `${inputs}amix=inputs=${sources.length}:duration=longest:normalize=0[aout]`;
  return ["-filter_complex", filter, "-map", "[aout]"];
}

function runFfmpegCollect(ffmpegPath, args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`FFmpeg command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (buf) => {
      stdout += String(buf);
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

function startSegmentCapture({
  ffmpegPath,
  sources,
  chunkSeconds,
  startIndex,
  segmentsDir,
  onLog
}) {
  fs.mkdirSync(segmentsDir, { recursive: true });
  const outputPattern = path.join(segmentsDir, "chunk_%05d.wav");
  const args = [
    "-hide_banner",
    "-y",
    ...buildInputArgs(sources),
    ...buildMixArgs(sources),
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    "-f",
    "segment",
    "-segment_time",
    String(chunkSeconds),
    "-segment_format",
    "wav",
    "-reset_timestamps",
    "1",
    "-segment_start_number",
    String(startIndex),
    outputPattern
  ];

  const child = spawn(ffmpegPath, args, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });

  child.stdout.on("data", (buf) => onLog && onLog(String(buf)));
  child.stderr.on("data", (buf) => onLog && onLog(String(buf)));

  return child;
}

async function startNativeLoopbackCapture({
  ffmpegPath,
  processId,
  chunkSeconds,
  startIndex,
  segmentsDir,
  onLog
}) {
  const loopback = await getLoopbackModule();
  if (!loopback) {
    throw new Error(
      "Native loopback module is not available. Run npm install and restart ClipScribe."
    );
  }
  const pid = String(processId || "").trim();
  if (!pid) {
    throw new Error("Invalid native loopback source: missing process ID.");
  }

  fs.mkdirSync(segmentsDir, { recursive: true });
  const outputPattern = path.join(segmentsDir, "chunk_%05d.wav");
  const ffmpegArgs = [
    "-hide_banner",
    "-y",
    "-f",
    "f32le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-i",
    "pipe:0",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    "-f",
    "segment",
    "-segment_time",
    String(chunkSeconds),
    "-segment_format",
    "wav",
    "-reset_timestamps",
    "1",
    "-segment_start_number",
    String(startIndex),
    outputPattern
  ];

  const child = spawn(ffmpegPath, ffmpegArgs, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdout.on("data", (buf) => onLog && onLog(String(buf)));
  child.stderr.on("data", (buf) => onLog && onLog(String(buf)));

  let stopped = false;
  let droppedPackets = 0;
  try {
    loopback.startAudioCapture(pid, {
      onData: (buf) => {
        if (stopped) {
          return;
        }
        try {
          const ok = child.stdin.write(buf);
          if (!ok) {
            droppedPackets += 1;
          }
        } catch (_) {
          // Ignore broken pipe writes during shutdown.
        }
      }
    });
  } catch (error) {
    child.kill();
    throw new Error(`Could not start native loopback for process ${pid}: ${error.message}`);
  }

  child.once("exit", () => {
    if (!stopped) {
      try {
        loopback.stopAudioCapture(pid);
      } catch (_) {
        // ignore
      }
    }
  });

  return {
    kind: "native-loopback",
    process: child,
    processId: pid,
    getStats() {
      return { dropped_packets: droppedPackets };
    },
    async stop(timeoutMs = 5000) {
      if (stopped) {
        return;
      }
      stopped = true;
      try {
        loopback.stopAudioCapture(pid);
      } catch (_) {
        // ignore
      }
      try {
        child.stdin.end();
      } catch (_) {
        // ignore
      }

      await new Promise((resolve) => {
        if (child.exitCode !== null || child.killed) {
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          if (child.exitCode === null && !child.killed) {
            child.kill();
          }
        }, timeoutMs);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  };
}

async function startWasapiDeviceLoopbackCapture({
  ffmpegPath,
  deviceId,
  sampleRate,
  channels,
  chunkSeconds,
  startIndex,
  segmentsDir,
  onLog
}) {
  const parsedDeviceId = Number.parseInt(String(deviceId || "").trim(), 10);
  if (!Number.isFinite(parsedDeviceId)) {
    throw new Error("Invalid loopback output device id.");
  }
  const inputChannels = Math.max(1, Number.parseInt(String(channels || 2), 10) || 2);
  const inputRate = Math.max(8000, Number.parseInt(String(sampleRate || 48000), 10) || 48000);

  fs.mkdirSync(segmentsDir, { recursive: true });
  const outputPattern = path.join(segmentsDir, "chunk_%05d.wav");
  const ffmpegArgs = [
    "-hide_banner",
    "-y",
    "-f",
    "f32le",
    "-ar",
    String(inputRate),
    "-ac",
    String(inputChannels),
    "-i",
    "pipe:0",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    "-f",
    "segment",
    "-segment_time",
    String(chunkSeconds),
    "-segment_format",
    "wav",
    "-reset_timestamps",
    "1",
    "-segment_start_number",
    String(startIndex),
    outputPattern
  ];

  const child = spawn(ffmpegPath, ffmpegArgs, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdout.on("data", (buf) => onLog && onLog(String(buf)));
  child.stderr.on("data", (buf) => onLog && onLog(String(buf)));

  let helper;
  try {
    helper = startNodeHelperStream(
      ["stream", String(parsedDeviceId), String(inputRate), String(inputChannels)],
      (line) => onLog && onLog(`[audify-helper] ${line}`)
    );
  } catch (error) {
    child.kill();
    throw new Error(
      `Could not start WASAPI output loopback helper: ${error?.message || String(error)}`
    );
  }
  let stopped = false;
  let droppedPackets = 0;
  let helperError = null;

  helper.stderr.on("data", (buf) => {
    helperError = String(buf || "").trim() || helperError;
  });
  helper.stdout.on("data", (buf) => {
    if (stopped) {
      return;
    }
    try {
      const ok = child.stdin.write(buf);
      if (!ok) {
        droppedPackets += 1;
      }
    } catch (_) {
      // Ignore broken pipe writes during shutdown.
    }
  });
  helper.on("error", (error) => {
    helperError = String(error?.message || error);
    if (!stopped && child.exitCode === null && !child.killed) {
      child.kill();
    }
  });
  helper.on("close", (code) => {
    if (!stopped && code !== 0 && child.exitCode === null && !child.killed) {
      child.kill();
    }
  });

  child.once("exit", () => {
    if (!stopped) {
      try {
        helper.kill();
      } catch (_) {
        // ignore
      }
    }
  });

  return {
    kind: "wasapi-loopback-device",
    process: child,
    deviceId: parsedDeviceId,
    getStats() {
      return { dropped_packets: droppedPackets, stream_warning: helperError };
    },
    async stop(timeoutMs = 5000) {
      if (stopped) {
        return;
      }
      stopped = true;
      try {
        helper.kill();
      } catch (_) {
        // ignore
      }
      try {
        child.stdin.end();
      } catch (_) {
        // ignore
      }

      await new Promise((resolve) => {
        if (child.exitCode !== null || child.killed) {
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          if (child.exitCode === null && !child.killed) {
            child.kill();
          }
        }, timeoutMs);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  };
}

function gracefulStop(child, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!child || child.killed || child.exitCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill();
      }
    }, timeoutMs);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });

    try {
      child.stdin.write("q");
    } catch (_) {
      child.kill();
    }
  });
}

function runFfmpeg(ffmpegPath, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`FFmpeg command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (buf) => {
      stdout += String(buf);
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        const shortStderr = stderr.slice(-1200);
        reject(new Error(`FFmpeg exited with code ${code}: ${shortStderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function checkBinary(ffmpegPath, args = ["-version"]) {
  try {
    const result = await runFfmpegCollect(ffmpegPath, args, 8000);
    return {
      ok: result.code === 0,
      output: `${result.stdout}\n${result.stderr}`.trim()
    };
  } catch (error) {
    return {
      ok: false,
      output: String(error?.message || error)
    };
  }
}

async function detectAudioCapabilities(ffmpegPath) {
  const result = await runFfmpegCollect(ffmpegPath, ["-hide_banner", "-devices"], 10000).catch(
    () => ({ code: 1, stdout: "", stderr: "" })
  );
  const text = `${result.stdout}\n${result.stderr}`;
  const lines = text.split(/\r?\n/);
  let hasDshow = false;
  let hasWasapi = false;
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (!trimmed) {
      continue;
    }
    // Expected rows contain capability flags then device name, e.g. "D  dshow".
    if (/\bdshow\b/.test(trimmed) && /^\s*[de\.]{1,2}\s+/i.test(line)) {
      hasDshow = true;
    }
    if (/\bwasapi\b/.test(trimmed) && /^\s*[de\.]{1,2}\s+/i.test(line)) {
      hasWasapi = true;
    }
  }

  return {
    has_dshow: hasDshow,
    has_wasapi: hasWasapi
  };
}

function classifyKindFromLabel(label) {
  const text = String(label || "").toLowerCase();
  if (
    text.includes("stereo mix") ||
    text.includes("what u hear") ||
    text.includes("what-you-hear") ||
    text.includes("monitor") ||
    text.includes("loopback") ||
    text.includes("cable output") ||
    text.includes("vb-audio") ||
    text.includes("voicemeeter output") ||
    text.includes("virtual-audio-capturer")
  ) {
    return "system";
  }
  return "mic";
}

async function listDirectShowAudioDevices(ffmpegPath) {
  const args = ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"];
  const result = await runFfmpegCollect(ffmpegPath, args, 10000).catch(() => ({
    code: 1,
    stdout: "",
    stderr: ""
  }));
  const lines = `${result.stdout}\n${result.stderr}`.split(/\r?\n/);

  const sources = [];
  const seen = new Set();
  let inAudioSection = false;
  for (const line of lines) {
    // Newer FFmpeg format:
    // [dshow @ ...] "Microphone (X)" (audio)
    const typedMatch = line.match(/"([^"]+)"\s*\((audio|video|none)\)/i);
    if (typedMatch) {
      const label = typedMatch[1];
      const deviceType = typedMatch[2].toLowerCase();
      if (deviceType === "audio" && !seen.has(label.toLowerCase())) {
        const kind = classifyKindFromLabel(label);
        sources.push({
          id: `dshow:${label}`,
          label,
          kind,
          format: "dshow",
          input: `audio=${label}`
        });
        seen.add(label.toLowerCase());
      }
      continue;
    }

    // Legacy FFmpeg format with explicit audio/video sections.
    if (line.includes("DirectShow audio devices")) {
      inAudioSection = true;
      continue;
    }
    if (inAudioSection && line.includes("DirectShow video devices")) {
      inAudioSection = false;
      continue;
    }
    if (!inAudioSection) {
      continue;
    }
    const match = line.match(/"([^"]+)"/);
    if (!match) {
      continue;
    }
    const label = match[1];
    if (seen.has(label.toLowerCase())) {
      continue;
    }
    const kind = classifyKindFromLabel(label);
    sources.push({
      id: `dshow:${label}`,
      label,
      kind,
      format: "dshow",
      input: `audio=${label}`
    });
    seen.add(label.toLowerCase());
  }
  return sources;
}

function assertSourceSupported(source, capabilities) {
  const format = source?.format || (source?.kind === "system" ? "wasapi" : "dshow");
  if (format === "loopback-process" || format === "wasapi-loopback-device") {
    return;
  }
  if (format === "wasapi" && !capabilities.has_wasapi) {
    throw new Error(
      "This FFmpeg build does not support WASAPI input. Select a DirectShow source (for example Stereo Mix) or install a full FFmpeg build."
    );
  }
  if (format === "dshow" && !capabilities.has_dshow) {
    throw new Error(
      "This FFmpeg build does not support DirectShow input, so local audio devices cannot be captured."
    );
  }
}

async function validateSourcesForCapture(ffmpegPath, sources) {
  const capabilities = await detectAudioCapabilities(ffmpegPath);
  const hasLoopbackProcessSource = (sources || []).some(
    (source) => source?.format === "loopback-process"
  );
  const hasOutputLoopbackSource = (sources || []).some(
    (source) => source?.format === "wasapi-loopback-device"
  );
  if (hasLoopbackProcessSource) {
    const loopback = await getLoopbackModule();
    if (!loopback) {
      throw new Error(
        "Native loopback capture package is missing. Run `npm install` and restart ClipScribe."
      );
    }
  }
  if (hasOutputLoopbackSource) {
    const helper = await checkAudifyHelper();
    if (!helper.ok) {
      throw new Error(
        `WASAPI output loopback capture is unavailable: ${helper.error}`
      );
    }
  }
  for (const source of sources || []) {
    assertSourceSupported(source, capabilities);
  }
  return capabilities;
}

function filterByProfile(profile) {
  switch (profile) {
    case "denoise":
      return "highpass=f=80,lowpass=f=7600,afftdn=nf=-22,acompressor=threshold=-18dB:ratio=2.5:attack=5:release=120,alimiter=limit=0.9";
    case "fast":
      return "highpass=f=80,lowpass=f=7600,acompressor=threshold=-20dB:ratio=2.0:attack=5:release=100,alimiter=limit=0.9";
    case "off":
    default:
      return null;
  }
}

async function preprocessForTranscription({
  ffmpegPath,
  inputPath,
  outputPath,
  profile,
  timeoutMs
}) {
  const filter = filterByProfile(profile || "off");
  if (!filter) {
    return {
      applied: false,
      output_path: inputPath,
      profile: "off"
    };
  }

  await runFfmpeg(
    ffmpegPath,
    [
      "-hide_banner",
      "-y",
      "-i",
      inputPath,
      "-af",
      filter,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      outputPath
    ],
    timeoutMs
  );

  return {
    applied: true,
    output_path: outputPath,
    profile
  };
}

async function concatSegmentsToMaster(ffmpegPath, segments, outputPath) {
  if (segments.length === 0) {
    throw new Error("No segments found to build master recording.");
  }

  const listPath = path.join(path.dirname(outputPath), "concat-list.txt");
  const rows = segments.map((segmentPath) => {
    const escaped = segmentPath.replace(/\\/g, "/").replace(/'/g, "'\\''");
    return `file '${escaped}'`;
  });
  fs.writeFileSync(listPath, `${rows.join("\n")}\n`, "utf8");

  try {
    await runFfmpeg(ffmpegPath, [
      "-hide_banner",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:a",
      "pcm_s16le",
      outputPath
    ], 60000);
  } finally {
    if (fs.existsSync(listPath)) {
      fs.unlinkSync(listPath);
    }
  }
}

async function getAudioDurationSeconds(ffprobePath, filePath) {
  return new Promise((resolve) => {
    const child = spawn(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"]
      }
    );
    let out = "";
    child.stdout.on("data", (buf) => {
      out += String(buf);
    });
    child.on("close", () => {
      const n = Number.parseFloat(out.trim());
      if (Number.isFinite(n) && n > 0) {
        resolve(n);
        return;
      }
      resolve(null);
    });
    child.on("error", () => resolve(null));
  });
}

function getFileSizeBytes(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch (_) {
    return 0;
  }
}

function listChunkWaveFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const entries = fs.readdirSync(dirPath);
  return entries
    .filter((name) => /^chunk_\d{5}\.wav$/i.test(name))
    .map((name) => path.join(dirPath, name))
    .sort((a, b) => a.localeCompare(b));
}

function buildNoAudioCapturedError(source, extra = "") {
  const label = String(source?.label || "").toLowerCase();
  const isOutput =
    source?.format === "wasapi-loopback-device" ||
    source?.format === "loopback-process" ||
    label.includes("system output") ||
    label.includes("loopback");
  if (isOutput) {
    return `No usable audio was captured from this output source test. Start playback on the selected speaker/headset, then click Test again.${extra}`;
  }
  return `No usable audio was captured from this source test. Speak/play audio into the selected input and click Test again.${extra}`;
}

async function buildValidatedTestResult(ffprobePath, source, testOutputPath, diagnostics = "") {
  const sizeBytes = getFileSizeBytes(testOutputPath);
  const durationSec = await getAudioDurationSeconds(ffprobePath, testOutputPath);
  const validDuration = Number.isFinite(durationSec) && durationSec > 0.15;
  const validSize = sizeBytes >= 512;
  if (!validDuration || !validSize) {
    const diag = diagnostics ? ` ${diagnostics}` : "";
    throw new Error(buildNoAudioCapturedError(source, diag));
  }
  return {
    test_file_path: testOutputPath,
    duration_sec: durationSec,
    file_size_bytes: sizeBytes
  };
}

async function testSource(ffmpegPath, ffprobePath, source, testOutputPath) {
  if (source?.format === "wasapi-loopback-device") {
    const segmentDir = path.dirname(testOutputPath);
    const priorChunks = listChunkWaveFiles(segmentDir);
    for (const prior of priorChunks) {
      try {
        fs.unlinkSync(prior);
      } catch (_) {
        // ignore cleanup failure
      }
    }

    const handle = await startWasapiDeviceLoopbackCapture({
      ffmpegPath,
      deviceId: source.device_id || source.input,
      sampleRate: source.sample_rate || 48000,
      channels: source.n_channels || 2,
      chunkSeconds: 4,
      startIndex: 0,
      segmentsDir: segmentDir
    });
    await new Promise((resolve) => setTimeout(resolve, 4500));
    await handle.stop();
    const stats = typeof handle.getStats === "function" ? handle.getStats() : {};
    const segmentCandidates = listChunkWaveFiles(segmentDir);
    if (segmentCandidates.length === 0) {
      throw new Error("Loopback output device test did not produce audio.");
    }
    let bestSegmentPath = segmentCandidates[0];
    let bestSegmentSize = getFileSizeBytes(bestSegmentPath);
    for (const candidatePath of segmentCandidates) {
      const candidateSize = getFileSizeBytes(candidatePath);
      if (candidateSize > bestSegmentSize) {
        bestSegmentPath = candidatePath;
        bestSegmentSize = candidateSize;
      }
    }
    fs.copyFileSync(bestSegmentPath, testOutputPath);
    const diagnostics = stats?.stream_warning ? `Helper warning: ${stats.stream_warning}` : "";
    return buildValidatedTestResult(ffprobePath, source, testOutputPath, diagnostics);
  }

  if (source?.format === "loopback-process") {
    const loopback = await getLoopbackModule();
    if (!loopback) {
      throw new Error("Native loopback module is unavailable.");
    }
    const pid = String(source.input || source.process_id || "").trim();
    if (!pid) {
      throw new Error("Invalid loopback process source.");
    }

    const child = spawn(
      ffmpegPath,
      [
        "-hide_banner",
        "-y",
        "-f",
        "f32le",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-i",
        "pipe:0",
        "-t",
        "4",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        testOutputPath
      ],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    let stderr = "";
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });

    loopback.startAudioCapture(pid, {
      onData: (buf) => {
        try {
          child.stdin.write(buf);
        } catch (_) {
          // ignore
        }
      }
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        try {
          child.kill();
        } catch (_) {
          // ignore
        }
        reject(new Error("Loopback test timed out."));
      }, 12000);

      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`Loopback test failed: ${stderr.slice(-1000)}`));
          return;
        }
        resolve();
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      setTimeout(() => {
        try {
          child.stdin.end();
        } catch (_) {
          // ignore
        }
      }, 4000);
    }).finally(() => {
      try {
        loopback.stopAudioCapture(pid);
      } catch (_) {
        // ignore
      }
    });

    return buildValidatedTestResult(ffprobePath, source, testOutputPath);
  }

  const capabilities = await detectAudioCapabilities(ffmpegPath);
  assertSourceSupported(source, capabilities);
  await runFfmpeg(
    ffmpegPath,
    [
      "-hide_banner",
      "-y",
      "-f",
      source.format || (source.kind === "system" ? "wasapi" : "dshow"),
      "-i",
      normalizeInput(source),
      "-t",
      "4",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      testOutputPath
    ],
    15000
  );

  return buildValidatedTestResult(ffprobePath, source, testOutputPath);
}

async function listAudioSources(ffmpegPath) {
  const capabilities = await detectAudioCapabilities(ffmpegPath);
  const loopback = await getLoopbackModule();
  const audifyInfo = await listWasapiOutputDevicesViaHelper();
  const sources = [];
  if (capabilities.has_dshow) {
    const dshowSources = await listDirectShowAudioDevices(ffmpegPath);
    sources.push(...dshowSources);
  }

  if (capabilities.has_wasapi) {
    sources.push({
      id: "wasapi:default-system",
      label: "System Audio (WASAPI Loopback: Default Device)",
      kind: "system",
      format: "wasapi",
      input: "audio=default"
    });
  }

  if (audifyInfo.ok) {
    const outputDevices = audifyInfo.devices
      .filter((device) => Number(device.outputChannels) > 0)
      .sort((a, b) => {
        const da = a.isDefaultOutput ? 0 : 1;
        const db = b.isDefaultOutput ? 0 : 1;
        return da - db || String(a.name).localeCompare(String(b.name));
      });
    for (const device of outputDevices) {
      const id = Number(device.id);
      if (!Number.isFinite(id)) {
        continue;
      }
      const nChannels = Math.max(1, Math.min(2, Number(device.outputChannels) || 2));
      const sampleRate = Math.max(8000, Number(device.preferredSampleRate) || 48000);
      const suffix = device.isDefaultOutput ? " (Default)" : "";
      sources.push({
        id: `wasapi-loopback:${id}`,
        label: `System Output: ${device.name}${suffix}`,
        kind: "system",
        format: "wasapi-loopback-device",
        input: String(id),
        device_id: id,
        n_channels: nChannels,
        sample_rate: sampleRate
      });
    }
  }

  if (loopback && typeof loopback.getActiveWindowProcessIds === "function") {
    const windows = await loopback.getActiveWindowProcessIds().catch(() => []);
    const byPid = new Map();
    for (const item of windows) {
      const pid = String(item?.processId || "").trim();
      const title = String(item?.title || "").trim();
      if (!pid || !title) {
        continue;
      }
      // Prefer longer title if multiple windows share same PID.
      const existing = byPid.get(pid);
      if (!existing || title.length > existing.title.length) {
        byPid.set(pid, { pid, title });
      }
    }
    for (const row of byPid.values()) {
      sources.push({
        id: `loopback:${row.pid}`,
        label: `App Loopback: ${row.title}`,
        kind: "system",
        format: "loopback-process",
        input: row.pid,
        process_id: row.pid
      });
    }
  }

  return {
    sources,
    capabilities: {
      ...capabilities,
      has_native_loopback: Boolean(loopback),
      has_wasapi_output_loopback: audifyInfo.ok
    }
  };
}

module.exports = {
  startSegmentCapture,
  startNativeLoopbackCapture,
  startWasapiDeviceLoopbackCapture,
  gracefulStop,
  concatSegmentsToMaster,
  getAudioDurationSeconds,
  listAudioSources,
  testSource,
  preprocessForTranscription,
  detectAudioCapabilities,
  validateSourcesForCapture,
  checkBinary
};
