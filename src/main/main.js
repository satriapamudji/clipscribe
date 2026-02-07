const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");

let mainWindow = null;
let services = null;
const startupLogPath = path.join(process.cwd(), "app-data", "startup.log");
let recoveredRendererOnce = false;

function logStartup(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.mkdirSync(path.dirname(startupLogPath), { recursive: true });
    fs.appendFileSync(startupLogPath, line, "utf8");
  } catch (_) {
    // ignore file logging failures
  }
  if (process.env.CLIPSCRIBE_DEBUG_STARTUP === "1") {
    try {
      console.log(message);
    } catch (_) {
      // ignore console logging failures
    }
  }
}

if (process.platform === "win32") {
  // Some Windows environments block Chromium sandbox IPC/ACL operations.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("disable-breakpad");
  app.commandLine.appendSwitch("disable-direct-composition");
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
}

function pickWritableRuntimeRoot() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const roamingAppData = (() => {
    try {
      return app.getPath("appData");
    } catch (_) {
      return "";
    }
  })();
  const candidates = [
    path.join(localAppData, "ClipScribe", "runtime"),
    path.join(roamingAppData, "ClipScribe", "runtime"),
    path.join(process.cwd(), "app-data", "runtime")
  ].filter((value) => String(value || "").trim());

  for (const root of candidates) {
    try {
      fs.mkdirSync(root, { recursive: true });
      const probe = path.join(root, ".write-probe");
      fs.writeFileSync(probe, "ok", "utf8");
      fs.unlinkSync(probe);
      return root;
    } catch (_) {
      // Try next candidate.
    }
  }
  return path.join(process.cwd(), "app-data", "runtime");
}

function configureElectronPaths() {
  const runtimeRoot = pickWritableRuntimeRoot();
  logStartup(`Runtime root selected: ${runtimeRoot}`);
  const userDataPath = path.join(runtimeRoot, "electron-user-data");
  const crashDumpsPath = path.join(runtimeRoot, "crashDumps");
  const logsPath = path.join(runtimeRoot, "logs");
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.mkdirSync(crashDumpsPath, { recursive: true });
    fs.mkdirSync(logsPath, { recursive: true });
    app.setPath("userData", userDataPath);
    app.setPath("crashDumps", crashDumpsPath);
    app.setAppLogsPath(logsPath);
    logStartup(
      `Electron paths configured: userData=${userDataPath} crashDumps=${crashDumpsPath}`
    );
  } catch (error) {
    logStartup(
      `Could not configure custom Electron runtime paths: ${
        error?.message || String(error)
      }`
    );
  }
}

if (process.env.CLIPSCRIBE_SKIP_RUNTIME_PATHS === "1") {
  logStartup("Skipping custom Electron runtime path configuration.");
} else {
  configureElectronPaths();
}

logStartup(
  `Env: ELECTRON_RUN_AS_NODE=${process.env.ELECTRON_RUN_AS_NODE || ""} ELECTRON_NO_ATTACH_CONSOLE=${
    process.env.ELECTRON_NO_ATTACH_CONSOLE || ""
  } CHROME_DEVEL_SANDBOX=${process.env.CHROME_DEVEL_SANDBOX || ""}`
);

function findInPathWindows(binName) {
  const result = spawnSync("where", [binName], {
    shell: true,
    encoding: "utf8"
  });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }
  const line = result.stdout.split(/\r?\n/).map((row) => row.trim()).find(Boolean);
  return line || null;
}

function searchFileBfs(rootDir, fileName, maxDepth = 4) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return null;
  }
  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current.dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
        return full;
      }
      if (entry.isDirectory() && current.depth < maxDepth) {
        queue.push({ dir: full, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

function detectFfmpegPaths() {
  const ffmpegPathFromPath = findInPathWindows("ffmpeg.exe");
  const ffprobePathFromPath = findInPathWindows("ffprobe.exe");
  if (ffmpegPathFromPath && ffprobePathFromPath) {
    return {
      ffmpeg_path: ffmpegPathFromPath,
      ffprobe_path: ffprobePathFromPath
    };
  }

  const local = process.env.LOCALAPPDATA || "";
  const common = [
    path.join("C:\\ffmpeg", "bin"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "ffmpeg", "bin"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "ffmpeg", "bin"),
    path.join(process.env.USERPROFILE || "", "scoop", "apps", "ffmpeg", "current", "bin"),
    path.join(local, "Programs", "ffmpeg", "bin")
  ];
  for (const dir of common) {
    const ffmpegPath = path.join(dir, "ffmpeg.exe");
    const ffprobePath = path.join(dir, "ffprobe.exe");
    if (fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath)) {
      return {
        ffmpeg_path: ffmpegPath,
        ffprobe_path: ffprobePath
      };
    }
  }

  const wingetRoot = path.join(local, "Microsoft", "WinGet", "Packages");
  const wingetFfmpeg = searchFileBfs(wingetRoot, "ffmpeg.exe", 5);
  const wingetFfprobe = searchFileBfs(wingetRoot, "ffprobe.exe", 5);
  if (wingetFfmpeg && wingetFfprobe) {
    return {
      ffmpeg_path: wingetFfmpeg,
      ffprobe_path: wingetFfprobe
    };
  }

  return null;
}

function runRepairNative() {
  const result = spawnSync("npm", ["run", "rebuild:native"], {
    cwd: process.cwd(),
    shell: true,
    encoding: "utf8"
  });
  const fullOutput = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  if (result.status === 0) {
    return {
      ok: true,
      message: "Native modules rebuilt successfully."
    };
  }

  if (
    /EBUSY|operation not permitted|resource busy or locked/i.test(fullOutput) &&
    /better-sqlite3|better_sqlite3|node-gyp/i.test(fullOutput)
  ) {
    return {
      ok: false,
      code: "module_locked",
      message:
        "Repair could not run while native modules are in use. Close ClipScribe, then run: npm run rebuild:native"
    };
  }

  if (/gyp ERR|node-gyp|msbuild/i.test(fullOutput)) {
    return {
      ok: false,
      code: "build_tooling",
      message:
        "Native rebuild failed (node-gyp/toolchain). Install Windows C++ Build Tools, then run: npm run rebuild:native"
    };
  }

  const firstLine = fullOutput.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "Unknown error";
  return {
    ok: false,
    code: "unknown",
    message: `Repair failed: ${firstLine}`
  };
}

function sendUpdate(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function initServices() {
  const { initDatabase } = require("./services/database");
  const { createRepository } = require("./services/repository");
  const { createSettingsService } = require("./services/settings");
  const { createTranscriptionWorker } = require("./services/transcription");
  const { getUsageBreakdown } = require("./services/deepgram");
  const { createRecordingService } = require("./services/recording");

  const appDataRoot = path.join(process.cwd(), "app-data");
  fs.mkdirSync(appDataRoot, { recursive: true });
  const dbPath = path.join(appDataRoot, "clipscribe.sqlite");
  const settingsPath = path.join(appDataRoot, "settings.json");
  const storageRoot = path.join(appDataRoot, "storage");
  fs.mkdirSync(storageRoot, { recursive: true });

  const db = initDatabase(dbPath);
  const repo = createRepository(db);
  repo.ensureDefaultFolder();

  const settingsService = createSettingsService({
    settingsPath,
    fallbackStorageRoot: storageRoot
  });

  const eventSink = {
    onSessionUpdated(sessionId) {
      sendUpdate("app:session-updated", { sessionId });
    },
    onGlobalUpdated() {
      sendUpdate("app:global-updated", { at: new Date().toISOString() });
    }
  };

  const transcriptionWorker = createTranscriptionWorker({
    repo,
    settingsService,
    eventSink
  });
  const recordingService = createRecordingService({
    repo,
    settingsService,
    transcriptionWorker,
    eventSink
  });

  recordingService.recoverInterruptedSessions();
  transcriptionWorker.start();

  services = {
    db,
    repo,
    settingsService,
    transcriptionWorker,
    recordingService,
    deepgramUsage: getUsageBreakdown
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.webContents.on("did-finish-load", () => {
    logStartup("renderer did-finish-load");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, code, description, validatedURL, isMainFrame) => {
      logStartup(
        `renderer did-fail-load code=${code} description=${description} url=${validatedURL} mainFrame=${isMainFrame}`
      );
    }
  );
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logStartup(
      `renderer render-process-gone reason=${details?.reason || ""} exitCode=${
        details?.exitCode ?? ""
      }`
    );
    // Recover once so a transient renderer crash doesn't look like app won't open.
    if (!recoveredRendererOnce) {
      recoveredRendererOnce = true;
      try {
        createWindow();
      } catch (_) {
        // ignore
      }
    }
  });
  mainWindow.on("closed", () => {
    logStartup("main window closed");
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function registerIpc() {
  function safeHandle(channel, handler) {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        return await handler(event, payload);
      } catch (error) {
        const message = error?.message || String(error);
        console.error(`[IPC:${channel}]`, message);
        throw new Error(message);
      }
    });
  }

  safeHandle("app:bootstrap", async () => {
    const { recordingService, settingsService } = services;
    const [sources, foldersWithSessions, runtimeHealth] = await Promise.all([
      recordingService.listSources().catch(() => []),
      Promise.resolve(recordingService.listFoldersWithSessions()),
      recordingService.getRuntimeHealth()
    ]);
    return {
      settings: settingsService.getSettings(),
      sources,
      folders: foldersWithSessions,
      runtime_health: runtimeHealth
    };
  });

  safeHandle("settings:get", async () => {
    return services.settingsService.getSettings();
  });

  safeHandle("settings:update", async (_, partial) => {
    const updated = services.settingsService.updateSettings(partial || {});
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return updated;
  });

  safeHandle("settings:auto-detect-ffmpeg", async () => {
    const found = detectFfmpegPaths();
    if (!found) {
      throw new Error("Could not auto-detect FFmpeg/FFprobe. Use CLI: clipscribe ffmpeg-detect.");
    }
    const updated = services.settingsService.updateSettings(found);
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return updated;
  });

  safeHandle("app:repair-native", async () => {
    return runRepairNative();
  });

  safeHandle("deepgram:usage-breakdown", async (_, payload) => {
    const settings = services.settingsService.getSettings();
    const apiKey = settings.deepgram_api_key;
    if (!apiKey) {
      throw new Error("Deepgram API key is missing. Set it in Transcription Settings.");
    }
    try {
      const usage = await services.deepgramUsage({
        apiKey,
        projectId: String(payload?.projectId || settings.deepgram_project_id || "").trim(),
        start: String(payload?.start || "").trim(),
        end: String(payload?.end || "").trim(),
        grouping: String(payload?.grouping || "").trim(),
        endpoint: "listen"
      });
      return { ok: true, usage };
    } catch (error) {
      const message = String(error?.message || error || "");
      const lower = message.toLowerCase();
      if (lower.includes("deepgram error 403") && lower.includes("required scope")) {
        return {
          ok: false,
          code: "forbidden_scope",
          message:
            "This API key can transcribe audio but cannot read usage data. Create/use a key with usage:read scope for this project."
        };
      }
      if (lower.includes("deepgram error 400")) {
        return {
          ok: false,
          code: "bad_request",
          message:
            "Deepgram usage query was rejected. Try grouping=none and a short recent date range."
        };
      }
      throw error;
    }
  });

  safeHandle("folders:create", async (_, name) => {
    const folder = services.repo.createFolder(name);
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return folder;
  });

  safeHandle("folders:delete", async (_, folderId) => {
    services.repo.deleteFolder(folderId);
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return { ok: true };
  });

  safeHandle("sessions:start", async (_, payload) => {
    const session = await services.recordingService.startSession(payload || {});
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return session;
  });

  safeHandle("sessions:pause", async (_, sessionId) => {
    await services.recordingService.pauseSession(sessionId);
    return services.recordingService.getSessionDetail(sessionId);
  });

  safeHandle("sessions:resume", async (_, sessionId) => {
    await services.recordingService.resumeSession(sessionId);
    return services.recordingService.getSessionDetail(sessionId);
  });

  safeHandle("sessions:stop", async (_, sessionId) => {
    await services.recordingService.stopSession(sessionId);
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return services.recordingService.getSessionDetail(sessionId);
  });

  safeHandle("sessions:detail", async (_, sessionId) => {
    return services.recordingService.getSessionDetail(sessionId);
  });

  safeHandle("sessions:get", async (_, sessionId) => {
    return services.repo.getSession(sessionId);
  });

  safeHandle("sessions:move", async (_, { sessionId, folderId }) => {
    return services.recordingService.moveSession(sessionId, folderId);
  });

  safeHandle("sessions:rename", async (_, { sessionId, title }) => {
    const renamed = services.recordingService.renameSession(sessionId, title);
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return renamed;
  });

  safeHandle("sessions:delete", async (_, sessionId) => {
    services.recordingService.deleteSession(sessionId);
    sendUpdate("app:global-updated", { at: new Date().toISOString() });
    return { ok: true };
  });

  safeHandle("sessions:change-sources", async (_, { sessionId, selectedSources }) => {
    return services.recordingService.changeSessionSources(sessionId, selectedSources);
  });

  safeHandle("audio:list-sources", async () => {
    return services.recordingService.listSources();
  });

  safeHandle("audio:test-source", async (_, { source, sessionId }) => {
    return services.recordingService.testAudioSource(source, sessionId);
  });

  safeHandle("files:read-binary", async (_, filePath) => {
    const targetPath = String(filePath || "").trim();
    if (!targetPath) {
      throw new Error("File path is required.");
    }
    const resolved = path.resolve(targetPath);
    const raw = fs.readFileSync(resolved);
    return raw.toString("base64");
  });
}

app.whenReady().then(() => {
  logStartup("app.whenReady resolved");
  initServices();
  logStartup("services initialized");
  registerIpc();
  logStartup("ipc registered");
  createWindow();
  logStartup("main window created");
}).catch((error) => {
  const message = error?.stack || error?.message || String(error);
  logStartup(`Startup failure: ${message}`);
  try {
    dialog.showErrorBox(
      "ClipScribe Startup Error",
      `${message}\n\nTry running: npm run rebuild:native`
    );
  } catch (_) {
    // ignore dialog failures in restricted environments
  }
  app.exit(1);
});

process.on("unhandledRejection", (error) => {
  const message = error?.stack || error?.message || String(error);
  logStartup(`Unhandled promise rejection: ${message}`);
});

process.on("uncaughtException", (error) => {
  const message = error?.stack || error?.message || String(error);
  logStartup(`Uncaught exception: ${message}`);
});

app.on("window-all-closed", () => {
  logStartup("window-all-closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  logStartup("before-quit");
  if (services?.transcriptionWorker) {
    services.transcriptionWorker.stop();
  }
});

app.on("child-process-gone", (_event, details) => {
  logStartup(
    `child-process-gone type=${details?.type || ""} reason=${details?.reason || ""} exitCode=${
      details?.exitCode ?? ""
    }`
  );
});
