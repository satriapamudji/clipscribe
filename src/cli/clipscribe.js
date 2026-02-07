#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");

const { getProjectRoot, getAppDataRoot, getSettingsPath } = require("./paths");
const { readSettings, writeSettings } = require("./settings-store");

const COLORS = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  reset: "\x1b[0m"
};

function colorize(color, text) {
  if (!stdout.isTTY) {
    return text;
  }
  return `${COLORS[color] || ""}${text}${COLORS.reset}`;
}

function isWin() {
  return process.platform === "win32";
}

function pathDirs() {
  const raw = process.env.PATH || process.env.Path || "";
  return raw.split(path.delimiter).filter(Boolean);
}

function pathExts() {
  if (!isWin()) {
    return [""];
  }
  const raw = process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD";
  return raw.split(";").filter(Boolean).map((e) => e.toLowerCase());
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function executableName(base) {
  if (!base) {
    return base;
  }
  if (isWin() && !base.toLowerCase().endsWith(".exe")) {
    return `${base}.exe`;
  }
  return base;
}

function resolvePathCandidate(candidate, binaryName = null) {
  if (!candidate) {
    return null;
  }
  const hasSlash = candidate.includes("\\") || candidate.includes("/");
  if (!hasSlash) {
    return findExecutable(candidate);
  }

  if (!fs.existsSync(candidate)) {
    return null;
  }

  const stat = fs.statSync(candidate);
  if (stat.isDirectory()) {
    const base = binaryName ? executableName(binaryName) : null;
    if (!base) {
      return null;
    }
    const joined = path.join(candidate, base);
    if (fs.existsSync(joined)) {
      return joined;
    }
    const inBin = path.join(candidate, "bin", base);
    if (fs.existsSync(inBin)) {
      return inBin;
    }
    return null;
  }

  return candidate;
}

function findFirstFile(rootDir, fileName, maxDepth = 4) {
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

function listCommonBinaryCandidates(binaryName) {
  const exe = executableName(binaryName);
  const candidates = [];

  if (binaryName === "ffmpeg" || binaryName === "ffprobe") {
    if (isWin()) {
      const user = process.env.USERPROFILE || "";
      const local = process.env.LOCALAPPDATA || "";
      const programFiles = process.env.ProgramFiles || "C:\\Program Files";
      const programFiles86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
      const chocoInstall = process.env.ChocolateyInstall || "C:\\ProgramData\\chocolatey";

      candidates.push(
        path.join("C:\\ffmpeg", "bin", exe),
        path.join(programFiles, "ffmpeg", "bin", exe),
        path.join(programFiles86, "ffmpeg", "bin", exe),
        path.join(chocoInstall, "bin", exe),
        path.join(user, "scoop", "apps", "ffmpeg", "current", "bin", exe),
        path.join(local, "Programs", "ffmpeg", "bin", exe)
      );

      const wingetPackagesRoot = path.join(local, "Microsoft", "WinGet", "Packages");
      const wingetHit = findFirstFile(wingetPackagesRoot, exe, 5);
      if (wingetHit) {
        candidates.push(wingetHit);
      }
    } else {
      candidates.push(`/usr/bin/${binaryName}`, `/usr/local/bin/${binaryName}`);
    }
  }

  return uniqueStrings(candidates);
}

function findExecutable(command) {
  if (!command) {
    return null;
  }
  const hasSlash = command.includes("\\") || command.includes("/");
  if (hasSlash) {
    return fs.existsSync(command) ? command : null;
  }

  for (const dir of pathDirs()) {
    if (isWin()) {
      const hasExt = Boolean(path.extname(command));
      if (hasExt) {
        const full = path.join(dir, command);
        if (fs.existsSync(full)) {
          return full;
        }
      } else {
        for (const ext of pathExts()) {
          const full = path.join(dir, `${command}${ext.toLowerCase()}`);
          if (fs.existsSync(full)) {
            return full;
          }
        }
      }
    } else {
      const full = path.join(dir, command);
      if (fs.existsSync(full)) {
        return full;
      }
    }
  }
  if (isWin()) {
    const aliasPath = path.join(
      process.env.LOCALAPPDATA || "",
      "Microsoft",
      "WindowsApps",
      `${command}.exe`
    );
    if (fs.existsSync(aliasPath)) {
      return aliasPath;
    }
  }
  return null;
}

function commandExists(command) {
  return Boolean(findExecutable(command));
}

function runSync(command, args, opts = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: isWin(),
    ...opts,
    cwd: getProjectRoot(),
    env: process.env
  });
}

function runSyncNoThrow(command, args, opts = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: isWin(),
    ...opts
  });
}

function execVersion(command) {
  const result = runSyncNoThrow(command, ["-version"]);
  if (result.status === 0) {
    return true;
  }
  // Some restricted environments disallow subprocess execution; treat command as present.
  return Boolean(result.error && ["EPERM", "EACCES"].includes(result.error.code));
}

function detectBinary(configuredPath, fallbackCommand) {
  const candidates = [];
  if (configuredPath) {
    candidates.push(configuredPath);
    if (isWin() && !configuredPath.toLowerCase().endsWith(".exe")) {
      candidates.push(`${configuredPath}.exe`);
    }
  }
  if (fallbackCommand) {
    candidates.push(fallbackCommand);
  }
  for (const candidate of listCommonBinaryCandidates(fallbackCommand)) {
    candidates.push(candidate);
  }

  for (const candidateRaw of uniqueStrings(candidates)) {
    if (!candidateRaw) {
      continue;
    }
    const resolved = resolvePathCandidate(candidateRaw, fallbackCommand);
    if (!resolved) {
      continue;
    }
    if (execVersion(resolved)) {
      return { found: true, command: resolved };
    }
  }
  return { found: false, command: fallbackCommand };
}

function autoDetectAndPersistFfmpegPaths() {
  const settings = readSettings();
  const ffmpeg = detectBinary(settings.ffmpeg_path, "ffmpeg");
  const ffprobe = detectBinary(settings.ffprobe_path, "ffprobe");
  const updates = {};
  if (ffmpeg.found && ffmpeg.command) {
    updates.ffmpeg_path = ffmpeg.command;
  }
  if (ffprobe.found && ffprobe.command) {
    updates.ffprobe_path = ffprobe.command;
  }
  if (Object.keys(updates).length > 0) {
    writeSettings(updates);
  }
  return {
    ffmpeg,
    ffprobe,
    updated: Object.keys(updates).length > 0
  };
}

function parseBoolFlag(args, name) {
  return args.includes(name);
}

function printCheck(ok, label, detail = "") {
  const icon = ok ? colorize("green", "[OK]") : colorize("red", "[NO]");
  const line = `${icon} ${label}${detail ? ` ${colorize("dim", `(${detail})`)}` : ""}`;
  console.log(line);
}

function printBanner() {
  console.log(colorize("cyan", "ClipScribe CLI"));
  console.log(colorize("dim", "Doctor, setup, updates, and dependency checks for the desktop app."));
}

function readPackageVersion() {
  try {
    const pkgPath = path.join(getProjectRoot(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.version || "0.0.0";
  } catch (_) {
    return "unknown";
  }
}

function getDoctorReport() {
  const settings = readSettings();
  const appDataRoot = getAppDataRoot();
  const settingsPath = getSettingsPath();

  const npmVersionResult = runSync("npm", ["--version"]);
  const npmFound = commandExists("npm");
  const npmVersion = npmVersionResult.status === 0 ? npmVersionResult.stdout.trim() : null;

  const ffmpeg = detectBinary(settings.ffmpeg_path, "ffmpeg");
  const ffprobe = detectBinary(settings.ffprobe_path, "ffprobe");
  const likelyWindowsApps = isWin() && (process.env.PATH || "").toLowerCase().includes("windowsapps");
  const winget = commandExists("winget") || likelyWindowsApps;
  const choco = commandExists("choco");
  const scoop = commandExists("scoop");

  return {
    app_version: readPackageVersion(),
    platform: `${os.platform()} ${os.release()}`,
    node_version: process.version,
    npm_found: npmFound,
    npm_version: npmVersion,
    project_root: getProjectRoot(),
    app_data_root: appDataRoot,
    settings_path: settingsPath,
    settings_exists: fs.existsSync(settingsPath),
    settings,
    deepgram_key_present: Boolean(settings.deepgram_api_key),
    ffmpeg_found: ffmpeg.found,
    ffmpeg_command: ffmpeg.command,
    ffprobe_found: ffprobe.found,
    ffprobe_command: ffprobe.command,
    managers: {
      winget,
      choco,
      scoop
    },
    dependencies: {
      node_modules_exists: fs.existsSync(path.join(getProjectRoot(), "node_modules")),
      electron_installed: fs.existsSync(path.join(getProjectRoot(), "node_modules", "electron")),
      native_loopback_installed: fs.existsSync(
        path.join(getProjectRoot(), "node_modules", "application-loopback")
      ),
      audify_installed: fs.existsSync(path.join(getProjectRoot(), "node_modules", "audify")),
      better_sqlite_installed: fs.existsSync(
        path.join(getProjectRoot(), "node_modules", "better-sqlite3")
      )
    }
  };
}

function printDoctorReport(report) {
  printBanner();
  console.log("");
  printCheck(Boolean(report.node_version), "Node.js", report.node_version);
  printCheck(report.npm_found, "npm", report.npm_version || "found");
  printCheck(report.dependencies.node_modules_exists, "node_modules");
  printCheck(report.dependencies.electron_installed, "electron package");
  printCheck(report.dependencies.native_loopback_installed, "native loopback package");
  printCheck(report.dependencies.audify_installed, "WASAPI output loopback package");
  printCheck(report.dependencies.better_sqlite_installed, "better-sqlite3 package");
  printCheck(report.settings_exists, "settings.json", report.settings_path);
  printCheck(report.deepgram_key_present, "Deepgram API key", report.deepgram_key_present ? "set" : "missing");
  printCheck(report.ffmpeg_found, "FFmpeg", report.ffmpeg_command || "not found");
  printCheck(report.ffprobe_found, "FFprobe", report.ffprobe_command || "not found");
  printCheck(report.managers.winget || report.managers.choco || report.managers.scoop, "Package manager", report.managers.winget ? "winget" : report.managers.choco ? "choco" : report.managers.scoop ? "scoop" : "none");

  console.log("");
  if (!report.ffmpeg_found || !report.ffprobe_found) {
    console.log(colorize("yellow", "FFmpeg missing. Install with:"));
    if (report.managers.winget) {
      console.log("  clipscribe ffmpeg-install --yes");
    } else if (report.managers.choco) {
      console.log("  choco install ffmpeg -y");
    } else if (report.managers.scoop) {
      console.log("  scoop install ffmpeg");
    } else {
      console.log("  Download from https://ffmpeg.org/download.html and add to PATH.");
    }
  }
  if (!report.deepgram_key_present) {
    console.log(colorize("yellow", "Deepgram key missing. Run: clipscribe tui"));
  }
}

function runCommandLive(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: isWin(),
      cwd: getProjectRoot(),
      ...opts
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function getElectronVersion() {
  try {
    const pkgPath = path.join(getProjectRoot(), "node_modules", "electron", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.version || null;
  } catch (_) {
    return null;
  }
}

async function repairNativeModules() {
  const electronVersion = getElectronVersion();
  if (!electronVersion) {
    console.log(colorize("red", "Electron is not installed. Run: npm install"));
    return 1;
  }
  console.log(colorize("cyan", `Rebuilding native modules for Electron ${electronVersion}...`));
  const args = [
    "rebuild",
    "better-sqlite3",
    "--runtime=electron",
    `--target=${electronVersion}`,
    "--dist-url=https://electronjs.org/headers"
  ];
  return runCommandLive("npm", args);
}

async function installFfmpeg(autoYes) {
  const likelyWindowsApps = isWin() && (process.env.PATH || "").toLowerCase().includes("windowsapps");
  const hasWinget = commandExists("winget") || likelyWindowsApps;
  const hasChoco = commandExists("choco");
  const hasScoop = commandExists("scoop");

  let command = null;
  let args = [];

  if (hasWinget) {
    command = "winget";
    args = [
      "install",
      "-e",
      "--id",
      "Gyan.FFmpeg",
      "--accept-source-agreements",
      "--accept-package-agreements"
    ];
  } else if (hasChoco) {
    command = "choco";
    args = ["install", "ffmpeg", "-y"];
  } else if (hasScoop) {
    command = "scoop";
    args = ["install", "ffmpeg"];
  } else {
    console.log("No supported package manager found.");
    console.log("Install manually from https://ffmpeg.org/download.html then add ffmpeg/ffprobe to PATH.");
    return 1;
  }

  console.log(`Installer command: ${command} ${args.join(" ")}`);
  if (!autoYes) {
    console.log("Re-run with --yes to execute automatically.");
    return 0;
  }

  const code = await runCommandLive(command, args);
  if (code !== 0) {
    console.log(colorize("red", `Install command failed (exit ${code}).`));
    return code;
  }
  console.log(colorize("green", "FFmpeg install command completed."));
  return 0;
}

async function runUpdate(autoYes) {
  console.log(colorize("cyan", "Checking outdated packages..."));
  await runCommandLive("npm", ["outdated"]);
  if (!autoYes) {
    console.log("Run `clipscribe update --yes` to apply npm updates.");
    return 0;
  }
  console.log(colorize("cyan", "Applying npm update..."));
  return runCommandLive("npm", ["update"]);
}

function printHelp() {
  printBanner();
  console.log("");
  console.log("Usage:");
  console.log("  clipscribe doctor [--json]");
  console.log("  clipscribe ffmpeg-install [--yes]");
  console.log("  clipscribe ffmpeg-detect");
  console.log("  clipscribe repair-native");
  console.log("  clipscribe update [--yes]");
  console.log("  clipscribe tui");
  console.log("  clipscribe start");
  console.log("");
  console.log("Examples:");
  console.log("  npm run clipscribe -- doctor");
  console.log("  .\\clipscribe.ps1 doctor");
}

async function pressEnter(rl) {
  await rl.question(colorize("dim", "\nPress Enter to continue..."));
}

async function runTui() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    let done = false;
    while (!done) {
      console.clear();
      const report = getDoctorReport();
      console.log(colorize("cyan", "ClipScribe Setup TUI"));
      console.log(colorize("dim", `${report.platform} | app v${report.app_version}`));
      console.log("");
      printCheck(report.ffmpeg_found && report.ffprobe_found, "FFmpeg/FFprobe");
      printCheck(report.deepgram_key_present, "Deepgram API key");
      console.log("");
      console.log("1. Run full doctor report");
      console.log("2. Install FFmpeg");
      console.log("3. Set Deepgram API key");
      console.log("4. Set FFmpeg path");
      console.log("5. Set FFprobe path");
      console.log("6. Set model/profile");
      console.log("7. Launch app");
      console.log("8. Auto-detect FFmpeg paths");
      console.log("9. Exit");
      const choice = (await rl.question("\nChoose an option [1-9]: ")).trim();

      if (choice === "1") {
        console.clear();
        printDoctorReport(getDoctorReport());
        await pressEnter(rl);
        continue;
      }
      if (choice === "2") {
        console.clear();
        await installFfmpeg(true);
        const detected = autoDetectAndPersistFfmpegPaths();
        if (detected.ffmpeg.found && detected.ffprobe.found) {
          console.log(
            colorize(
              "green",
              `Auto-detected FFmpeg paths: ${detected.ffmpeg.command} | ${detected.ffprobe.command}`
            )
          );
        }
        await pressEnter(rl);
        continue;
      }
      if (choice === "3") {
        const key = (await rl.question("Deepgram API key: ")).trim();
        writeSettings({ deepgram_api_key: key });
        console.log(colorize("green", "Saved."));
        await pressEnter(rl);
        continue;
      }
      if (choice === "4") {
        const value = (await rl.question("FFmpeg path (default: ffmpeg): ")).trim();
        writeSettings({ ffmpeg_path: value || "ffmpeg" });
        console.log(colorize("green", "Saved."));
        await pressEnter(rl);
        continue;
      }
      if (choice === "5") {
        const value = (await rl.question("FFprobe path (default: ffprobe): ")).trim();
        writeSettings({ ffprobe_path: value || "ffprobe" });
        console.log(colorize("green", "Saved."));
        await pressEnter(rl);
        continue;
      }
      if (choice === "6") {
        const model = (await rl.question("Model (nova-3|nova-2) [nova-3]: ")).trim() || "nova-3";
        const profile =
          (await rl.question("Enhancement profile (fast|denoise|off) [fast]: ")).trim() || "fast";
        const timeoutText =
          (await rl.question("Enhancement timeout ms [5000]: ")).trim() || "5000";
        const timeout = Number.parseInt(timeoutText, 10);
        writeSettings({
          deepgram_model: model,
          transcription_preprocess_profile: profile,
          transcription_preprocess_timeout_ms: Number.isInteger(timeout) ? timeout : 5000
        });
        console.log(colorize("green", "Saved."));
        await pressEnter(rl);
        continue;
      }
      if (choice === "7") {
        console.clear();
        await runCommandLive("npm", ["start"]);
        await pressEnter(rl);
        continue;
      }
      if (choice === "8") {
        const detected = autoDetectAndPersistFfmpegPaths();
        if (detected.ffmpeg.found) {
          console.log(colorize("green", `FFmpeg found: ${detected.ffmpeg.command}`));
        } else {
          console.log(colorize("red", "FFmpeg not found."));
        }
        if (detected.ffprobe.found) {
          console.log(colorize("green", `FFprobe found: ${detected.ffprobe.command}`));
        } else {
          console.log(colorize("red", "FFprobe not found."));
        }
        await pressEnter(rl);
        continue;
      }
      if (choice === "9") {
        done = true;
        continue;
      }
    }
  } finally {
    rl.close();
  }
  return 0;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "doctor") {
    const report = getDoctorReport();
    if (parseBoolFlag(args, "--json")) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    printDoctorReport(report);
    return;
  }

  if (command === "ffmpeg-install") {
    const code = await installFfmpeg(parseBoolFlag(args, "--yes"));
    process.exitCode = code;
    return;
  }

  if (command === "ffmpeg-detect") {
    const detected = autoDetectAndPersistFfmpegPaths();
    if (detected.ffmpeg.found) {
      console.log(`FFmpeg: ${detected.ffmpeg.command}`);
    } else {
      console.log("FFmpeg: not found");
    }
    if (detected.ffprobe.found) {
      console.log(`FFprobe: ${detected.ffprobe.command}`);
    } else {
      console.log("FFprobe: not found");
    }
    process.exitCode = detected.ffmpeg.found && detected.ffprobe.found ? 0 : 1;
    return;
  }

  if (command === "update") {
    const code = await runUpdate(parseBoolFlag(args, "--yes"));
    process.exitCode = code;
    return;
  }

  if (command === "repair-native") {
    const code = await repairNativeModules();
    process.exitCode = code;
    return;
  }

  if (command === "tui" || command === "setup") {
    const code = await runTui();
    process.exitCode = code;
    return;
  }

  if (command === "start") {
    const code = await runCommandLive("npm", ["start"]);
    process.exitCode = code;
    return;
  }

  console.log(colorize("red", `Unknown command: ${command}`));
  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(colorize("red", error?.stack || error?.message || String(error)));
  process.exitCode = 1;
});
