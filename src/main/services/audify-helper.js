#!/usr/bin/env node

const { RtAudio, RtAudioApi, RtAudioFormat } = require("audify");

function toInt(value, fallback) {
  const n = Number.parseInt(String(value || ""), 10);
  if (Number.isFinite(n)) {
    return n;
  }
  return fallback;
}

function listDevices() {
  const rt = new RtAudio(RtAudioApi.WINDOWS_WASAPI);
  const devices = rt.getDevices();
  return devices.map((device) => ({
    id: device.id,
    name: device.name,
    outputChannels: device.outputChannels,
    inputChannels: device.inputChannels,
    isDefaultOutput: Boolean(device.isDefaultOutput),
    isDefaultInput: Boolean(device.isDefaultInput),
    preferredSampleRate: device.preferredSampleRate
  }));
}

function runCheck() {
  // Verify module can load and enumerate without crashing.
  listDevices();
  process.exit(0);
}

function runList() {
  const devices = listDevices();
  process.stdout.write(`${JSON.stringify({ devices })}\n`);
  process.exit(0);
}

function runStream(deviceIdRaw, sampleRateRaw, channelsRaw) {
  const deviceId = toInt(deviceIdRaw, NaN);
  if (!Number.isFinite(deviceId)) {
    throw new Error("Invalid device id.");
  }
  const sampleRate = Math.max(8000, toInt(sampleRateRaw, 48000));
  const channels = Math.max(1, toInt(channelsRaw, 2));

  const rt = new RtAudio(RtAudioApi.WINDOWS_WASAPI);
  let stopped = false;

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    try {
      rt.setInputCallback(null);
    } catch (_) {
      // ignore
    }
    try {
      rt.setFrameOutputCallback(null);
    } catch (_) {
      // ignore
    }
    try {
      rt.stop();
    } catch (_) {
      // ignore
    }
    try {
      rt.closeStream();
    } catch (_) {
      // ignore
    }
    setTimeout(() => process.exit(0), 20);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("disconnect", stop);

  rt.openStream(
    { deviceId, nChannels: channels, firstChannel: 0 },
    { deviceId, nChannels: channels, firstChannel: 0 },
    RtAudioFormat.RTAUDIO_FLOAT32,
    sampleRate,
    1024,
    "ClipScribeAudifyHelper",
    (buf) => {
      if (stopped) {
        return;
      }
      try {
        process.stdout.write(buf);
      } catch (_) {
        // ignore broken pipe
      }
    },
    null,
    0,
    (type, message) => {
      try {
        process.stderr.write(`[audify:${type}] ${message}\n`);
      } catch (_) {
        // ignore
      }
    }
  );
  rt.start();
}

function main() {
  const [mode, ...rest] = process.argv.slice(2);
  try {
    if (mode === "check") {
      runCheck();
      return;
    }
    if (mode === "list") {
      runList();
      return;
    }
    if (mode === "stream") {
      runStream(rest[0], rest[1], rest[2]);
      return;
    }
    throw new Error("Unknown mode. Use check | list | stream.");
  } catch (error) {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exit(1);
  }
}

main();
