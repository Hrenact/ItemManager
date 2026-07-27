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
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
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
  if (colorPick) {
    const { resolve } = colorPick;
    closeColorPick();
    resolve(null);
  }

  const html = createColorPickHtml();
  const displays = screen.getAllDisplays();
  const windows = displays.map(() => {
    const pickerWindow = new BrowserWindow({
      width: 1,
      height: 1,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreenable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    pickerWindow.setAlwaysOnTop(true, "screen-saver");
    return pickerWindow;
  });

  const result = new Promise((resolve, reject) => {
    colorPick = { windows, resolve, reject };
  });
  Promise.all(windows.map((pickerWindow) => pickerWindow.loadURL(`data:text/html;charset=utf-8,${html}`)))
    .then(() => {
      if (!colorPick || colorPick.windows !== windows) return;
      windows.forEach((pickerWindow, index) => {
        const { x, y, width, height } = displays[index].bounds;
        pickerWindow.setPosition(x, y, false);
        pickerWindow.setSize(width, height, false);
        pickerWindow.setBounds({ x, y, width, height }, false);
        pickerWindow.showInactive();
      });
      for (const pickerWindow of windows) {
        pickerWindow.setAlwaysOnTop(true, "screen-saver");
        pickerWindow.moveTop();
      }

      const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const focusIndex = displays.findIndex((display) => display.id === cursorDisplay.id);
      const focusWindow = windows[focusIndex] || windows[0];
      if (focusWindow && !focusWindow.isDestroyed()) focusWindow.focus();
    })
    .catch((error) => {
      if (!colorPick || colorPick.windows !== windows) return;
      const { reject } = colorPick;
      closeColorPick();
      reject(error);
    });
  return result;
}

ipcMain.handle("pick-screen-color", () => startColorPick());

ipcMain.handle("pick-local-path", async (event, kind) => {
  if (!["file", "folder", "image"].includes(kind)) {
    throw new Error("Picker kind must be file, folder, or image.");
  }
  const properties = kind === "folder" ? ["openDirectory"] : ["openFile"];
  const filters = kind === "image"
    ? [{ name: "图片文件", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] }]
    : [];
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(owner, {
    title: kind === "folder" ? "选择本地文件夹" : kind === "image" ? "选择封面图片" : "选择本地文件",
    properties,
    filters
  });
  return { localPath: result.canceled ? "" : result.filePaths[0] || "" };
});

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
  const { resolve } = colorPick;
  closeColorPick();
  resolve(null);
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

  let devToolsWindow = null;

  function closeDevTools() {
    if (!window.isDestroyed() && window.webContents.isDevToolsOpened()) {
      window.webContents.closeDevTools();
    }
    if (devToolsWindow && !devToolsWindow.isDestroyed()) {
      devToolsWindow.destroy();
    }
    devToolsWindow = null;
  }

  function handleDevToolsShortcut(event, input) {
    if (input.type !== "keyDown" || input.key !== "F12" || input.isAutoRepeat) return;

    event.preventDefault();
    if (devToolsWindow && !devToolsWindow.isDestroyed()) {
      closeDevTools();
    } else {
      openDevTools();
    }
  }

  function openDevTools() {
    const toolsWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 760,
      minHeight: 480,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: "#ffffff"
    });
    devToolsWindow = toolsWindow;

    toolsWindow.webContents.on("before-input-event", handleDevToolsShortcut);
    toolsWindow.once("ready-to-show", () => {
      if (toolsWindow.isDestroyed()) return;
      toolsWindow.show();
      toolsWindow.focus();
    });
    toolsWindow.on("closed", () => {
      if (devToolsWindow === toolsWindow) devToolsWindow = null;
      if (!window.isDestroyed() && window.webContents.isDevToolsOpened()) {
        window.webContents.closeDevTools();
      }
    });

    window.webContents.setDevToolsWebContents(toolsWindow.webContents);
    window.webContents.openDevTools({ mode: "detach", activate: true });
  }

  window.webContents.on("before-input-event", handleDevToolsShortcut);
  window.once("closed", closeDevTools);
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
