const fs = require("node:fs");
const path = require("node:path");
const { preprocessForTranscription } = require("./ffmpeg");
const { transcribePreRecorded } = require("./deepgram");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatClock(totalSec) {
  const sec = Math.max(0, Math.floor(toNumber(totalSec)));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  if (hh > 0) {
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function countWords(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) {
    return 0;
  }
  return cleaned.split(/\s+/).filter(Boolean).length;
}

function normalizeUtterances(utterances) {
  const rows = (utterances || [])
    .map((item) => ({
      start: toNumber(item?.start),
      end: toNumber(item?.end),
      speaker: Number.isFinite(Number(item?.speaker)) ? Number(item.speaker) : null,
      transcript: String(item?.transcript || "").trim()
    }))
    .filter((item) => item.transcript)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const item of rows) {
    const last = merged[merged.length - 1];
    const sameSpeaker = last && last.speaker === item.speaker;
    const shortGap = last && item.start - last.end <= 0.8;
    if (sameSpeaker && shortGap) {
      last.end = Math.max(last.end, item.end);
      last.transcript = `${last.transcript} ${item.transcript}`.replace(/\s+/g, " ").trim();
      continue;
    }
    merged.push({ ...item });
  }
  return merged;
}

function formatTranscriptResult(result, chunkStartSec) {
  const utterances = normalizeUtterances(
    Array.isArray(result?.utterances) ? result.utterances : []
  );
  const utteranceLines = utterances
    .map((item) => {
      const text = String(item?.transcript || "").trim();
      if (!text) {
        return "";
      }
      const start = chunkStartSec + toNumber(item?.start);
      const end = chunkStartSec + toNumber(item?.end);
      const speakerPrefix =
        Number.isFinite(Number(item?.speaker)) ? `Speaker ${Number(item.speaker)}: ` : "";
      return `[${formatClock(start)} - ${formatClock(end)}] ${speakerPrefix}${text}`;
    })
    .filter(Boolean);
  if (utteranceLines.length > 0) {
    return utteranceLines.join("\n");
  }

  const paragraphs = Array.isArray(result?.paragraphs) ? result.paragraphs : [];
  const paragraphLines = paragraphs
    .map((item) => {
      const text = String(item?.transcript || "").trim();
      if (!text) {
        return "";
      }
      const start = chunkStartSec + toNumber(item?.start);
      const end = chunkStartSec + toNumber(item?.end);
      const speakerPrefix =
        Number.isFinite(Number(item?.speaker)) ? `Speaker ${Number(item.speaker)}: ` : "";
      return `[${formatClock(start)} - ${formatClock(end)}] ${speakerPrefix}${text}`;
    })
    .filter(Boolean);
  if (paragraphLines.length > 0) {
    return paragraphLines.join("\n");
  }

  return String(result?.transcript || "").trim();
}

function buildEnhancedChunkPath(chunkPath) {
  const dir = path.dirname(chunkPath);
  const ext = path.extname(chunkPath);
  const base = path.basename(chunkPath, ext);
  return path.join(dir, `${base}.enhanced${ext || ".wav"}`);
}

function createTranscriptionWorker({
  repo,
  settingsService,
  eventSink,
  maxRetries = 3
}) {
  let running = false;
  let loopTimer = null;

  function emitStateChange(sessionId) {
    if (eventSink && typeof eventSink.onSessionUpdated === "function") {
      eventSink.onSessionUpdated(sessionId);
    }
  }

  async function processChunk(chunk) {
    repo.markChunkProcessing(chunk.id);
    emitStateChange(chunk.session_id);

    const settings = settingsService.getSettings();
    let transcriptionInputPath = chunk.file_path;
    let enhancedPath = null;
    try {
      if (settings.transcription_preprocess_profile !== "off") {
        enhancedPath = buildEnhancedChunkPath(chunk.file_path);
        const prep = await preprocessForTranscription({
          ffmpegPath: settings.ffmpeg_path,
          inputPath: chunk.file_path,
          outputPath: enhancedPath,
          profile: settings.transcription_preprocess_profile,
          timeoutMs: settings.transcription_preprocess_timeout_ms
        }).catch(() => ({
          applied: false,
          output_path: chunk.file_path
        }));
        transcriptionInputPath = prep.output_path || chunk.file_path;
      }

      const dgResult = await transcribePreRecorded({
        apiKey: settings.deepgram_api_key,
        model: settings.deepgram_model,
        filePath: transcriptionInputPath
      });
      const text = formatTranscriptResult(dgResult, Number(chunk.start_sec || 0));
      const meta = {
        request_id: dgResult.request_id || null,
        confidence: toNumber(dgResult.confidence || 0),
        word_count: Number.isFinite(Number(dgResult.word_count))
          ? Number(dgResult.word_count)
          : countWords(text),
        utterance_count: Array.isArray(dgResult.utterances) ? dgResult.utterances.length : 0,
        paragraph_count: Array.isArray(dgResult.paragraphs) ? dgResult.paragraphs.length : 0,
        duration_sec: toNumber(dgResult.duration_sec || 0),
        model_name: dgResult.model_name || settings.deepgram_model || "nova-3"
      };
      repo.completeChunk({
        chunkId: chunk.id,
        text,
        meta,
        provider: "deepgram",
        status: "done",
        errorMessage: null,
        retryCount: chunk.retry_count
      });
      if (!text) {
        const sourceLabel = String(chunk.source_label || "").trim();
        const trackLabel = sourceLabel || String(chunk.track_id || "").trim() || "selected source";
        const warningAtSec = Math.max(
          Number(chunk.start_sec || 0),
          Number(chunk.start_sec || 0) + Number(meta.duration_sec || 0)
        );
        repo.addEvent(chunk.session_id, "warning", warningAtSec, {
          code: "no_speech_detected",
          track_id: String(chunk.track_id || "").trim() || null,
          source_label: sourceLabel || null,
          message:
            `Deepgram returned no speech for this chunk (${trackLabel}). Confirm that source is carrying spoken voice/audio.`
        });
      }
    } catch (error) {
      const nextRetryCount = (chunk.retry_count || 0) + 1;
      repo.completeChunk({
        chunkId: chunk.id,
        text: chunk.text || "",
        provider: "deepgram",
        status: nextRetryCount >= maxRetries ? "failed" : "queued",
        errorMessage: error.message,
        retryCount: nextRetryCount
      });
      if (nextRetryCount < maxRetries) {
        await sleep(750 * nextRetryCount);
      }
    } finally {
      if (enhancedPath && enhancedPath !== chunk.file_path && fs.existsSync(enhancedPath)) {
        fs.unlinkSync(enhancedPath);
      }
    }
    emitStateChange(chunk.session_id);
  }

  async function tick() {
    if (!running) {
      return;
    }
    const queued = repo.listQueuedChunks();
    if (queued.length === 0) {
      return;
    }
    const chunk = queued[0];
    await processChunk(chunk);
  }

  function schedule() {
    if (loopTimer) {
      clearInterval(loopTimer);
    }
    loopTimer = setInterval(() => {
      tick().catch(() => undefined);
    }, 1000);
  }

  return {
    start() {
      if (running) {
        return;
      }
      running = true;
      schedule();
      tick().catch(() => undefined);
    },

    stop() {
      running = false;
      if (loopTimer) {
        clearInterval(loopTimer);
        loopTimer = null;
      }
    },

    kick() {
      tick().catch(() => undefined);
    }
  };
}

module.exports = {
  createTranscriptionWorker
};
