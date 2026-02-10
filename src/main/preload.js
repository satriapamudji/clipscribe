const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld("clipscribe", {
  bootstrap: () => invoke("app:bootstrap"),
  repairNative: () => invoke("app:repair-native"),
  getSettings: () => invoke("settings:get"),
  updateSettings: (partial) => invoke("settings:update", partial),
  autoDetectFfmpeg: () => invoke("settings:auto-detect-ffmpeg"),
  getDeepgramUsageBreakdown: (payload) => invoke("deepgram:usage-breakdown", payload),
  listDeepgramModels: () => invoke("deepgram:list-models"),
  listOpenRouterFreeModels: () => invoke("openrouter:list-free-models"),
  getOpenRouterKeyInfo: () => invoke("openrouter:key-info"),
  getOpenRouterRawLogInfo: () => invoke("openrouter:raw-log-info"),
  openOpenRouterRawLog: () => invoke("openrouter:open-raw-log"),

  createFolder: (name) => invoke("folders:create", name),
  deleteFolder: (folderId) => invoke("folders:delete", folderId),

  startSession: (payload) => invoke("sessions:start", payload),
  pauseSession: (sessionId) => invoke("sessions:pause", sessionId),
  resumeSession: (sessionId) => invoke("sessions:resume", sessionId),
  stopSession: (sessionId) => invoke("sessions:stop", sessionId),
  getSessionDetail: (sessionId) => invoke("sessions:detail", sessionId),
  getSession: (sessionId) => invoke("sessions:get", sessionId),
  moveSession: (sessionId, folderId) => invoke("sessions:move", { sessionId, folderId }),
  renameSession: (sessionId, title) => invoke("sessions:rename", { sessionId, title }),
  generateSessionSummary: (sessionId) => invoke("sessions:generate-summary", sessionId),
  askSessionChat: (sessionId, question) => invoke("sessions:chat", { sessionId, question }),
  setSessionSpeakerAlias: (sessionId, speakerId, alias) =>
    invoke("sessions:set-speaker-alias", { sessionId, speakerId, alias }),
  deleteSession: (sessionId) => invoke("sessions:delete", sessionId),
  changeSessionSources: (sessionId, selectedSources) =>
    invoke("sessions:change-sources", { sessionId, selectedSources }),

  listSources: () => invoke("audio:list-sources"),
  testSource: (source, sessionId) => invoke("audio:test-source", { source, sessionId }),
  readFileBase64: (filePath) => invoke("files:read-binary", filePath),

  onGlobalUpdated: (cb) => {
    const handler = (_evt, payload) => cb(payload);
    ipcRenderer.on("app:global-updated", handler);
    return () => ipcRenderer.removeListener("app:global-updated", handler);
  },
  onSessionUpdated: (cb) => {
    const handler = (_evt, payload) => cb(payload);
    ipcRenderer.on("app:session-updated", handler);
    return () => ipcRenderer.removeListener("app:session-updated", handler);
  },
  onSummaryProgress: (cb) => {
    const handler = (_evt, payload) => cb(payload);
    ipcRenderer.on("app:summary-progress", handler);
    return () => ipcRenderer.removeListener("app:summary-progress", handler);
  }
});
