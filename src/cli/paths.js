const path = require("node:path");

function getProjectRoot() {
  return path.resolve(__dirname, "..", "..");
}

function getAppDataRoot() {
  return path.join(getProjectRoot(), "app-data");
}

function getSettingsPath() {
  return path.join(getAppDataRoot(), "settings.json");
}

function getStorageRoot() {
  return path.join(getAppDataRoot(), "storage");
}

module.exports = {
  getProjectRoot,
  getAppDataRoot,
  getSettingsPath,
  getStorageRoot
};
