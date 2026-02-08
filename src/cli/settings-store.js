const fs = require("node:fs");
const path = require("node:path");
const { getSettingsPath, getStorageRoot } = require("./paths");
const DEFAULT_SUMMARY_MODEL = "meta-llama/llama-3.1-70b-instruct:free";

const DEFAULT_SETTINGS = Object.freeze({
  chunk_seconds: 120,
  deepgram_api_key: "",
  deepgram_model: "nova-3",
  openrouter_api_key: "",
  openrouter_model: DEFAULT_SUMMARY_MODEL,
  ffmpeg_path: "ffmpeg",
  ffprobe_path: "ffprobe",
  storage_root: "",
  default_sources: [],
  audio_test_output_device: "",
  transcription_preprocess_profile: "fast",
  transcription_preprocess_timeout_ms: 5000
});

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readSettings() {
  const settingsPath = getSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    return { ...DEFAULT_SETTINGS, storage_root: getStorageRoot() };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const merged = { ...DEFAULT_SETTINGS, ...raw };
    if (!String(merged.openrouter_model || "").trim()) {
      merged.openrouter_model = DEFAULT_SUMMARY_MODEL;
    }
    if (!merged.storage_root) {
      merged.storage_root = getStorageRoot();
    }
    return merged;
  } catch (_) {
    return { ...DEFAULT_SETTINGS, storage_root: getStorageRoot() };
  }
}

function writeSettings(partial) {
  const settingsPath = getSettingsPath();
  ensureDirFor(settingsPath);
  const next = {
    ...readSettings(),
    ...(partial || {})
  };
  if (!next.storage_root) {
    next.storage_root = getStorageRoot();
  }
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

module.exports = {
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings
};
