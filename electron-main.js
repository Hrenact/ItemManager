const { app, BrowserWindow, dialog } = require("electron");
const fs = require("fs");
const path = require("path");

let server;

function archiveDirectory() {
  return app.isPackaged
    ? path.join(process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath), "data")
    : path.join(__dirname, "data");
}

function ensureArchiveDirectory(target) {
  if (fs.existsSync(target)) return;

  const bundledData = app.isPackaged
    ? path.join(process.resourcesPath, "data")
    : path.join(__dirname, "data");

  if (fs.existsSync(bundledData)) {
    fs.cpSync(bundledData, target, { recursive: true });
  } else {
    fs.mkdirSync(target, { recursive: true });
  }
}

async function createWindow() {
  const dataDirectory = archiveDirectory();
  ensureArchiveDirectory(dataDirectory);
  process.env.ITEM_MANAGER_DATA_DIR = dataDirectory;

  const { startServer } = require("./server");
  const started = await startServer(0);
  server = started.server;

  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    autoHideMenuBar: true,
    backgroundColor: "#11151d",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await window.loadURL(`http://127.0.0.1:${started.port}`);
}

app.whenReady().then(createWindow).catch((error) => {
  dialog.showErrorBox("Item Manager failed to start", error.stack || error.message);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (server) server.close();
});
