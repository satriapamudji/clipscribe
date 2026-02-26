const crypto = require("node:crypto");

function nowIso() {
  return new Date().toISOString();
}

function legacyTrackIdForSession(sessionId) {
  return `legacy:${String(sessionId || "").trim()}`;
}

function toSessionRow(session) {
  if (!session) {
    return null;
  }
  return {
    ...session,
    selected_sources: JSON.parse(session.selected_sources_json || "[]")
  };
}

function safeParseJson(text, fallback = null) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch (_) {
    return fallback;
  }
}

function toChunkRow(chunk) {
  if (!chunk) {
    return null;
  }
  return {
    ...chunk,
    meta: safeParseJson(chunk.meta_json, null)
  };
}

function toTrackRow(track) {
  if (!track) {
    return null;
  }
  return {
    ...track,
    source: safeParseJson(track.source_json, null)
  };
}

function createRepository(db) {
  const createFolderStmt = db.prepare(
    `INSERT INTO folders (id, name, created_at) VALUES (@id, @name, @created_at)`
  );
  const listFoldersStmt = db.prepare(
    `SELECT id, name, created_at FROM folders ORDER BY name ASC`
  );
  const getFolderStmt = db.prepare(
    `SELECT id, name, created_at FROM folders WHERE id = ?`
  );
  const deleteFolderStmt = db.prepare(`DELETE FROM folders WHERE id = ?`);

  const createSessionStmt = db.prepare(`
    INSERT INTO sessions (
      id, folder_id, title, status, started_at, ended_at, chunk_seconds,
      audio_master_path, summary_text, summary_brief_text, summary_model, summary_generated_at,
      session_dir, selected_sources_json, recorded_seconds,
      created_at, updated_at
    ) VALUES (
      @id, @folder_id, @title, @status, @started_at, @ended_at, @chunk_seconds,
      @audio_master_path, @summary_text, @summary_brief_text, @summary_model, @summary_generated_at,
      @session_dir, @selected_sources_json, @recorded_seconds,
      @created_at, @updated_at
    )
  `);
  const updateSessionStmt = db.prepare(`
    UPDATE sessions
    SET status = @status,
        ended_at = @ended_at,
        audio_master_path = @audio_master_path,
        selected_sources_json = @selected_sources_json,
        recorded_seconds = @recorded_seconds,
        updated_at = @updated_at
    WHERE id = @id
  `);
  const getSessionStmt = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
  const listSessionsStmt = db.prepare(`
    SELECT * FROM sessions
    WHERE folder_id = ?
    ORDER BY datetime(created_at) DESC
  `);
  const moveSessionStmt = db.prepare(`
    UPDATE sessions SET folder_id = ?, updated_at = ? WHERE id = ?
  `);
  const renameSessionStmt = db.prepare(`
    UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?
  `);
  const updateSessionSummaryStmt = db.prepare(`
    UPDATE sessions
    SET summary_text = @summary_text,
        summary_brief_text = @summary_brief_text,
        summary_model = @summary_model,
        summary_generated_at = @summary_generated_at,
        updated_at = @updated_at
    WHERE id = @id
  `);
  const deleteSessionStmt = db.prepare(`DELETE FROM sessions WHERE id = ?`);
  const listActiveSessionsStmt = db.prepare(`
    SELECT * FROM sessions WHERE status IN ('recording', 'paused')
  `);

  const createSessionTrackStmt = db.prepare(`
    INSERT INTO session_tracks (
      id, session_id, track_key, track_order,
      source_label, source_format, source_kind, source_input, source_device_id, source_process_id,
      source_json, status, error_message, started_at_sec, ended_at_sec, created_at, updated_at
    ) VALUES (
      @id, @session_id, @track_key, @track_order,
      @source_label, @source_format, @source_kind, @source_input, @source_device_id, @source_process_id,
      @source_json, @status, @error_message, @started_at_sec, @ended_at_sec, @created_at, @updated_at
    )
  `);
  const getSessionTrackStmt = db.prepare(`
    SELECT * FROM session_tracks WHERE id = ?
  `);
  const getSessionTrackByKeyStmt = db.prepare(`
    SELECT * FROM session_tracks WHERE session_id = ? AND track_key = ?
  `);
  const listSessionTracksStmt = db.prepare(`
    SELECT * FROM session_tracks
    WHERE session_id = ?
    ORDER BY track_order ASC, datetime(created_at) ASC
  `);
  const updateSessionTrackStmt = db.prepare(`
    UPDATE session_tracks
    SET status = @status,
        error_message = @error_message,
        ended_at_sec = @ended_at_sec,
        updated_at = @updated_at
    WHERE id = @id
  `);

  const createChunkStmt = db.prepare(`
    INSERT INTO transcript_chunks (
      id, session_id, track_id, chunk_index, start_sec, end_sec, text, meta_json, provider, status,
      retry_count, error_message, file_path, created_at, updated_at
    ) VALUES (
      @id, @session_id, @track_id, @chunk_index, @start_sec, @end_sec, @text, @meta_json, @provider, @status,
      @retry_count, @error_message, @file_path, @created_at, @updated_at
    )
  `);
  const getChunkBySessionTrackIndexStmt = db.prepare(`
    SELECT * FROM transcript_chunks WHERE session_id = ? AND track_id = ? AND chunk_index = ?
  `);
  const listChunksForSessionStmt = db.prepare(`
    SELECT
      c.*,
      st.track_order AS track_order,
      st.source_label AS source_label
    FROM transcript_chunks c
    LEFT JOIN session_tracks st ON st.id = c.track_id
    WHERE c.session_id = ?
    ORDER BY
      c.start_sec ASC,
      c.end_sec ASC,
      COALESCE(st.track_order, 0) ASC,
      c.chunk_index ASC,
      datetime(c.created_at) ASC
  `);
  const listChunksForSessionTrackStmt = db.prepare(`
    SELECT
      c.*,
      st.track_order AS track_order,
      st.source_label AS source_label
    FROM transcript_chunks c
    LEFT JOIN session_tracks st ON st.id = c.track_id
    WHERE c.session_id = ? AND c.track_id = ?
    ORDER BY c.chunk_index ASC
  `);
  const updateChunkTimingStmt = db.prepare(`
    UPDATE transcript_chunks
    SET start_sec = @start_sec,
        end_sec = @end_sec,
        updated_at = @updated_at
    WHERE id = @id
  `);
  const updateChunkTranscriptionStmt = db.prepare(`
    UPDATE transcript_chunks
    SET text = @text,
        meta_json = @meta_json,
        provider = @provider,
        status = @status,
        retry_count = @retry_count,
        error_message = @error_message,
        updated_at = @updated_at
    WHERE id = @id
  `);
  const markChunkProcessingStmt = db.prepare(`
    UPDATE transcript_chunks
    SET status = @status,
        updated_at = @updated_at
    WHERE id = @id
  `);
  const listQueuedChunksStmt = db.prepare(`
    SELECT
      c.*,
      st.track_order AS track_order,
      st.source_label AS source_label
    FROM transcript_chunks c
    LEFT JOIN session_tracks st ON st.id = c.track_id
    WHERE c.status = 'queued'
    ORDER BY datetime(c.created_at) ASC, COALESCE(st.track_order, 0) ASC, c.chunk_index ASC
  `);

  const createEventStmt = db.prepare(`
    INSERT INTO session_events (
      id, session_id, event_type, at_sec, payload_json, created_at
    ) VALUES (
      @id, @session_id, @event_type, @at_sec, @payload_json, @created_at
    )
  `);
  const listEventsStmt = db.prepare(`
    SELECT * FROM session_events
    WHERE session_id = ?
    ORDER BY at_sec ASC, datetime(created_at) ASC
  `);
  const createChatMessageStmt = db.prepare(`
    INSERT INTO session_chat_messages (
      id, session_id, role, content, citations_json, meta_json, created_at
    ) VALUES (
      @id, @session_id, @role, @content, @citations_json, @meta_json, @created_at
    )
  `);
  const listChatMessagesStmt = db.prepare(`
    SELECT * FROM session_chat_messages
    WHERE session_id = ?
    ORDER BY datetime(created_at) ASC
  `);

  function ensureDefaultFolder() {
    const existing = listFoldersStmt.all();
    if (existing.length > 0) {
      return existing[0];
    }
    const folder = {
      id: crypto.randomUUID(),
      name: "Inbox",
      created_at: nowIso()
    };
    createFolderStmt.run(folder);
    return folder;
  }

  function ensureLegacyTrackForSession(sessionId) {
    const session = getSessionStmt.get(sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }
    const trackId = legacyTrackIdForSession(sessionId);
    const existing = getSessionTrackStmt.get(trackId);
    if (existing) {
      return toTrackRow(existing);
    }
    const createdAt = nowIso();
    const row = {
      id: trackId,
      session_id: session.id,
      track_key: "legacy-mix",
      track_order: 0,
      source_label: "Mixed Input",
      source_format: "mixed",
      source_kind: "mixed",
      source_input: null,
      source_device_id: null,
      source_process_id: null,
      source_json: session.selected_sources_json || "[]",
      status: session.status || "stopped",
      error_message: null,
      started_at_sec: 0,
      ended_at_sec: null,
      created_at: createdAt,
      updated_at: createdAt
    };
    createSessionTrackStmt.run(row);
    return toTrackRow(getSessionTrackStmt.get(trackId));
  }

  return {
    ensureDefaultFolder,

    listFolders() {
      return listFoldersStmt.all();
    },

    createFolder(name) {
      const folder = {
        id: crypto.randomUUID(),
        name: String(name || "").trim(),
        created_at: nowIso()
      };
      if (!folder.name) {
        throw new Error("Folder name is required.");
      }
      createFolderStmt.run(folder);
      return folder;
    },

    deleteFolder(folderId) {
      const folder = getFolderStmt.get(folderId);
      if (!folder) {
        return;
      }
      const sessions = listSessionsStmt.all(folderId);
      if (sessions.length > 0) {
        throw new Error("Cannot delete a folder that contains sessions.");
      }
      deleteFolderStmt.run(folderId);
    },

    createSession({ id, folderId, title, chunkSeconds, sessionDir, selectedSources }) {
      const startedAt = nowIso();
      const row = {
        id: id || crypto.randomUUID(),
        folder_id: folderId,
        title: String(title || "").trim() || "Untitled Session",
        status: "recording",
        started_at: startedAt,
        ended_at: null,
        chunk_seconds: chunkSeconds,
        audio_master_path: null,
        summary_text: null,
        summary_brief_text: null,
        summary_model: null,
        summary_generated_at: null,
        session_dir: sessionDir,
        selected_sources_json: JSON.stringify(selectedSources || []),
        recorded_seconds: 0,
        created_at: startedAt,
        updated_at: startedAt
      };
      createSessionStmt.run(row);
      return toSessionRow(getSessionStmt.get(row.id));
    },

    updateSession({ id, status, endedAt, audioMasterPath, selectedSources, recordedSeconds }) {
      const existing = getSessionStmt.get(id);
      if (!existing) {
        throw new Error("Session not found.");
      }
      const payload = {
        id,
        status: status || existing.status,
        ended_at: endedAt === undefined ? existing.ended_at : endedAt,
        audio_master_path:
          audioMasterPath === undefined ? existing.audio_master_path : audioMasterPath,
        selected_sources_json:
          selectedSources === undefined
            ? existing.selected_sources_json
            : JSON.stringify(selectedSources),
        recorded_seconds:
          recordedSeconds === undefined ? existing.recorded_seconds : recordedSeconds,
        updated_at: nowIso()
      };
      updateSessionStmt.run(payload);
      return toSessionRow(getSessionStmt.get(id));
    },

    moveSession(sessionId, folderId) {
      moveSessionStmt.run(folderId, nowIso(), sessionId);
      return toSessionRow(getSessionStmt.get(sessionId));
    },

    renameSession(sessionId, title) {
      const session = getSessionStmt.get(sessionId);
      if (!session) {
        throw new Error("Session not found.");
      }
      const trimmed = String(title || "").trim();
      if (!trimmed) {
        throw new Error("Session title is required.");
      }
      renameSessionStmt.run(trimmed, nowIso(), sessionId);
      return toSessionRow(getSessionStmt.get(sessionId));
    },

    updateSessionSummary(sessionId, summaryText, summaryModel, summaryBriefText = "") {
      const session = getSessionStmt.get(sessionId);
      if (!session) {
        throw new Error("Session not found.");
      }
      updateSessionSummaryStmt.run({
        id: sessionId,
        summary_text: String(summaryText || "").trim() || null,
        summary_brief_text: String(summaryBriefText || "").trim() || null,
        summary_model: String(summaryModel || "").trim() || null,
        summary_generated_at: nowIso(),
        updated_at: nowIso()
      });
      return toSessionRow(getSessionStmt.get(sessionId));
    },

    deleteSession(sessionId) {
      const session = getSessionStmt.get(sessionId);
      if (!session) {
        return;
      }
      deleteSessionStmt.run(sessionId);
    },

    getSession(sessionId) {
      return toSessionRow(getSessionStmt.get(sessionId));
    },

    listSessions(folderId) {
      return listSessionsStmt.all(folderId).map(toSessionRow);
    },

    listActiveSessions() {
      return listActiveSessionsStmt.all().map(toSessionRow);
    },

    createSessionTrack({ id, sessionId, trackKey, trackOrder, source, status = "recording" }) {
      const session = getSessionStmt.get(sessionId);
      if (!session) {
        throw new Error("Session not found.");
      }
      const sourceObj = source && typeof source === "object" ? source : {};
      const normalizedTrackKey = String(trackKey || sourceObj.id || "").trim();
      if (!normalizedTrackKey) {
        throw new Error("trackKey is required.");
      }
      const createdAt = nowIso();
      const row = {
        id: String(id || crypto.randomUUID()).trim(),
        session_id: String(sessionId).trim(),
        track_key: normalizedTrackKey,
        track_order: Number.isInteger(trackOrder) ? trackOrder : 0,
        source_label: String(sourceObj.label || sourceObj.id || "Input").trim() || "Input",
        source_format: String(sourceObj.format || "").trim() || "unknown",
        source_kind: String(sourceObj.kind || "").trim() || null,
        source_input: sourceObj.input == null ? null : String(sourceObj.input),
        source_device_id: sourceObj.device_id == null ? null : String(sourceObj.device_id),
        source_process_id: sourceObj.process_id == null ? null : String(sourceObj.process_id),
        source_json: JSON.stringify(sourceObj || {}),
        status: String(status || "recording").trim() || "recording",
        error_message: null,
        started_at_sec: 0,
        ended_at_sec: null,
        created_at: createdAt,
        updated_at: createdAt
      };
      createSessionTrackStmt.run(row);
      return toTrackRow(getSessionTrackStmt.get(row.id));
    },

    getSessionTrack(trackId) {
      return toTrackRow(getSessionTrackStmt.get(trackId));
    },

    listSessionTracks(sessionId) {
      return listSessionTracksStmt.all(sessionId).map(toTrackRow);
    },

    updateSessionTrack({ id, status, errorMessage, endedAtSec }) {
      const existing = getSessionTrackStmt.get(id);
      if (!existing) {
        throw new Error("Session track not found.");
      }
      updateSessionTrackStmt.run({
        id,
        status: status === undefined ? existing.status : String(status || existing.status),
        error_message:
          errorMessage === undefined
            ? existing.error_message
            : (String(errorMessage || "").trim() || null),
        ended_at_sec:
          endedAtSec === undefined
            ? existing.ended_at_sec
            : (Number.isFinite(Number(endedAtSec)) ? Number(endedAtSec) : null),
        updated_at: nowIso()
      });
      return toTrackRow(getSessionTrackStmt.get(id));
    },

    upsertChunk({
      sessionId,
      trackId,
      chunkIndex,
      startSec,
      endSec,
      filePath
    }) {
      const effectiveTrackId = String(trackId || "").trim() || legacyTrackIdForSession(sessionId);
      if (effectiveTrackId === legacyTrackIdForSession(sessionId)) {
        ensureLegacyTrackForSession(sessionId);
      } else if (!getSessionTrackStmt.get(effectiveTrackId)) {
        throw new Error(`Session track not found: ${effectiveTrackId}`);
      }
      const existing = getChunkBySessionTrackIndexStmt.get(sessionId, effectiveTrackId, chunkIndex);
      if (existing) {
        return toChunkRow(existing);
      }
      const createdAt = nowIso();
      const row = {
        id: crypto.randomUUID(),
        session_id: sessionId,
        track_id: effectiveTrackId,
        chunk_index: chunkIndex,
        start_sec: startSec,
        end_sec: endSec,
        text: null,
        meta_json: null,
        provider: null,
        status: "queued",
        retry_count: 0,
        error_message: null,
        file_path: filePath,
        created_at: createdAt,
        updated_at: createdAt
      };
      createChunkStmt.run(row);
      return toChunkRow(getChunkBySessionTrackIndexStmt.get(sessionId, effectiveTrackId, chunkIndex));
    },

    markChunkProcessing(chunkId) {
      markChunkProcessingStmt.run({ id: chunkId, status: "processing", updated_at: nowIso() });
    },

    completeChunk({
      chunkId,
      text,
      meta,
      provider,
      status,
      errorMessage,
      retryCount
    }) {
      updateChunkTranscriptionStmt.run({
        id: chunkId,
        text: text || "",
        meta_json: meta ? JSON.stringify(meta) : null,
        provider: provider || null,
        status,
        retry_count: Number.isFinite(retryCount) ? retryCount : 0,
        error_message: errorMessage || null,
        updated_at: nowIso()
      });
    },

    updateChunkTiming({ chunkId, startSec, endSec }) {
      updateChunkTimingStmt.run({
        id: chunkId,
        start_sec: startSec,
        end_sec: endSec,
        updated_at: nowIso()
      });
    },

    listSessionChunks(sessionId, options = {}) {
      const requestedTrackId = String(options?.trackId || "").trim();
      if (requestedTrackId) {
        return listChunksForSessionTrackStmt.all(sessionId, requestedTrackId).map(toChunkRow);
      }
      return listChunksForSessionStmt.all(sessionId).map(toChunkRow);
    },

    listQueuedChunks() {
      return listQueuedChunksStmt.all().map(toChunkRow);
    },

    addEvent(sessionId, eventType, atSec, payload = null) {
      createEventStmt.run({
        id: crypto.randomUUID(),
        session_id: sessionId,
        event_type: eventType,
        at_sec: atSec,
        payload_json: payload ? JSON.stringify(payload) : null,
        created_at: nowIso()
      });
    },

    listSessionEvents(sessionId) {
      return listEventsStmt.all(sessionId).map((event) => ({
        ...event,
        payload: safeParseJson(event.payload_json, null)
      }));
    },

    addSessionChatMessage(sessionId, role, content, citations = [], meta = null) {
      const normalizedRole = String(role || "").trim().toLowerCase();
      if (!["user", "assistant", "system"].includes(normalizedRole)) {
        throw new Error("Chat role must be user, assistant, or system.");
      }
      const message = {
        id: crypto.randomUUID(),
        session_id: String(sessionId || "").trim(),
        role: normalizedRole,
        content: String(content || "").trim(),
        citations_json: Array.isArray(citations) && citations.length > 0
          ? JSON.stringify(citations)
          : null,
        meta_json: meta && typeof meta === "object" ? JSON.stringify(meta) : null,
        created_at: nowIso()
      };
      if (!message.session_id) {
        throw new Error("sessionId is required.");
      }
      if (!message.content) {
        throw new Error("Chat content is required.");
      }
      createChatMessageStmt.run(message);
      return {
        id: message.id,
        session_id: message.session_id,
        role: message.role,
        content: message.content,
        citations: safeParseJson(message.citations_json, []),
        meta: safeParseJson(message.meta_json, null),
        created_at: message.created_at
      };
    },

    listSessionChatMessages(sessionId) {
      return listChatMessagesStmt.all(sessionId).map((row) => ({
        id: row.id,
        session_id: row.session_id,
        role: String(row.role || "").trim().toLowerCase(),
        content: String(row.content || ""),
        citations: safeParseJson(row.citations_json, []),
        meta: safeParseJson(row.meta_json, null),
        created_at: row.created_at
      }));
    }
  };
}

module.exports = {
  createRepository
};
