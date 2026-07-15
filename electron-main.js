const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen } = require("electron");
const fs = require("fs");
const path = require("path");

let server;
let colorPick = null;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("enable-features", "OverlayScrollbar");

function executableDirectory() {
  return app.isPackaged
    ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath))
    : __dirname;
}

function archiveDirectory() {
  return path.join(executableDirectory(), "data");
}

function configurePortableProfile() {
  const profileDirectory = path.join(archiveDirectory(), "electron-profile");
  fs.mkdirSync(profileDirectory, { recursive: true });

  app.setPath("userData", profileDirectory);
  app.setPath("sessionData", path.join(profileDirectory, "session"));
  app.commandLine.appendSwitch("disk-cache-dir", path.join(profileDirectory, "cache"));
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

function colorToHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function sampleNativeImage(image, x, y) {
  const size = image.getSize();
  const bitmap = image.toBitmap();
  const clampedX = Math.max(0, Math.min(size.width - 1, Math.floor(x)));
  const clampedY = Math.max(0, Math.min(size.height - 1, Math.floor(y)));
  const offset = (clampedY * size.width + clampedX) * 4;

  return colorToHex({
    b: bitmap[offset],
    g: bitmap[offset + 1],
    r: bitmap[offset + 2]
  });
}

async function colorAtScreenPoint(point) {
  const display = screen.getDisplayNearestPoint(point);
  const scale = display.scaleFactor || 1;
  const captureSize = {
    width: Math.round(display.size.width * scale),
    height: Math.round(display.size.height * scale)
  };
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: captureSize
  });
  const source = sources.find((entry) => String(entry.display_id) === String(display.id)) || sources[0];
  if (!source) throw new Error("Unable to capture screen.");

  const x = (point.x - display.bounds.x) * scale;
  const y = (point.y - display.bounds.y) * scale;
  return sampleNativeImage(source.thumbnail, x, y);
}

function createColorPickHtml() {
  return encodeURIComponent(`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        cursor: crosshair;
        background: rgba(6, 9, 14, 0.18);
        font-family: "Segoe UI", system-ui, sans-serif;
        user-select: none;
      }
      .hint {
        position: fixed;
        left: 50%;
        top: 28px;
        transform: translateX(-50%);
        padding: 10px 14px;
        border: 1px solid rgba(89, 195, 195, 0.75);
        border-radius: 8px;
        background: rgba(13, 16, 23, 0.88);
        color: #eef2f8;
        font-size: 13px;
        box-shadow: 0 18px 44px rgba(0, 0, 0, 0.38);
      }
    </style>
  </head>
  <body>
    <div class="hint">点击任意屏幕位置取色，按 Esc 取消</div>
    <script>
      window.addEventListener("mousedown", (event) => {
        event.preventDefault();
        window.itemManager.finishScreenColorPick({ x: event.screenX, y: event.screenY });
      });
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") window.itemManager.cancelScreenColorPick();
      });
    </script>
  </body>
</html>`);
}

function closeColorPick() {
  if (!colorPick) return;
  for (const pickerWindow of colorPick.windows) {
    if (!pickerWindow.isDestroyed()) pickerWindow.close();
  }
  colorPick = null;
}

function startColorPick() {
  if (colorPick) closeColorPick();

  const html = createColorPickHtml();
  const windows = screen.getAllDisplays().map((display) => {
    const pickerWindow = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    pickerWindow.setAlwaysOnTop(true, "screen-saver");
    pickerWindow.loadURL(`data:text/html;charset=utf-8,${html}`);
    return pickerWindow;
  });

  return new Promise((resolve, reject) => {
    colorPick = { windows, resolve, reject };
  });
}

ipcMain.handle("pick-screen-color", () => startColorPick());

ipcMain.on("finish-screen-color-pick", async (_event, point) => {
  if (!colorPick) return;
  const { resolve, reject } = colorPick;
  closeColorPick();
  try {
    resolve(await colorAtScreenPoint(point));
  } catch (error) {
    reject(error);
  }
});

ipcMain.on("cancel-screen-color-pick", () => {
  if (!colorPick) return;
  const { reject } = colorPick;
  closeColorPick();
  reject(new Error("Color picking canceled."));
});

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
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await window.loadURL(`http://127.0.0.1:${started.port}`);
}

configurePortableProfile();

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
