const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SETTINGS = Object.freeze({
  chunk_seconds: 120,
  deepgram_api_key: "",
  deepgram_project_id: "",
  deepgram_model: "nova-3",
  ffmpeg_path: "ffmpeg",
  ffprobe_path: "ffprobe",
  storage_root: "",
  default_sources: [],
  audio_test_output_device: "",
  transcription_preprocess_profile: "fast",
  transcription_preprocess_timeout_ms: 5000,
  estimated_stt_usd_per_min: 0.0043
});

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function createSettingsService({ settingsPath, fallbackStorageRoot }) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  function getSettings() {
    const raw = loadJson(settingsPath) || {};
    const merged = { ...DEFAULT_SETTINGS, ...raw };
    if (!merged.storage_root) {
      merged.storage_root = fallbackStorageRoot;
    }
    return merged;
  }

  function updateSettings(partial) {
    const next = {
      ...getSettings(),
      ...(partial || {})
    };

    if (!next.storage_root) {
      next.storage_root = fallbackStorageRoot;
    }

    if (!Number.isInteger(next.chunk_seconds) || next.chunk_seconds < 30) {
      throw new Error("chunk_seconds must be an integer >= 30.");
    }
    if (
      !["off", "fast", "denoise"].includes(next.transcription_preprocess_profile)
    ) {
      throw new Error("transcription_preprocess_profile must be off, fast, or denoise.");
    }
    if (
      !Number.isInteger(next.transcription_preprocess_timeout_ms) ||
      next.transcription_preprocess_timeout_ms < 1000 ||
      next.transcription_preprocess_timeout_ms > 20000
    ) {
      throw new Error("transcription_preprocess_timeout_ms must be between 1000 and 20000.");
    }
    if (
      !Number.isFinite(Number(next.estimated_stt_usd_per_min)) ||
      Number(next.estimated_stt_usd_per_min) < 0 ||
      Number(next.estimated_stt_usd_per_min) > 10
    ) {
      throw new Error("estimated_stt_usd_per_min must be between 0 and 10.");
    }
    next.estimated_stt_usd_per_min = Number(next.estimated_stt_usd_per_min);

    fs.mkdirSync(next.storage_root, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2), "utf8");
    return next;
  }

  return {
    getSettings,
    updateSettings
  };
}

module.exports = {
  createSettingsService
};
