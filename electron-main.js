const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, net, screen } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const APP_PROTOCOL = "booth-library-manager";
const DEFAULT_DESKTOP_SETTINGS = {
  associateProtocol: false,
  downloadDirectory: "",
  allowDevTools: false
};

let server;
let colorPick = null;
let mainWindow = null;
let devToolsWindow = null;
let desktopSettings = { ...DEFAULT_DESKTOP_SETTINGS };
let rendererReadyForImports = false;
let serverOrigin = "";
const pendingProtocolUrls = [];
const activeDownloads = new Map();
const reservedDownloadPaths = new Set();

const initialProtocolUrl = findProtocolUrl(process.argv);
if (initialProtocolUrl && isItemImportAction(initialProtocolUrl)) pendingProtocolUrls.push(initialProtocolUrl);

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("enable-features", "OverlayScrollbar");

function findProtocolUrl(commandLine) {
  return commandLine.find((argument) =>
    argument.toLowerCase().startsWith(`${APP_PROTOCOL}://`)
  ) || null;
}

function isItemImportAction(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === `${APP_PROTOCOL}:` && url.hostname.toLowerCase() === "item-import";
  } catch {
    return false;
  }
}

function cleanDesktopSettings(settings = {}) {
  return {
    associateProtocol: settings.associateProtocol === true,
    downloadDirectory: String(settings.downloadDirectory || "").trim(),
    allowDevTools: settings.allowDevTools === true
  };
}

class ItemImportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function emitItemImportEvent(payload) {
  if (!rendererReadyForImports || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("item-import-event", payload);
}

function enqueueProtocolUrl(url) {
  if (!String(url || "").toLowerCase().startsWith(`${APP_PROTOCOL}://`)) return;
  if (isItemImportAction(url)) pendingProtocolUrls.push(url);
  restoreMainWindow();
  flushProtocolUrls();
}

function flushProtocolUrls() {
  if (!rendererReadyForImports || !mainWindow || mainWindow.isDestroyed()) return;
  while (pendingProtocolUrls.length) {
    const url = pendingProtocolUrls.shift();
    startItemImport(url).catch((error) => {
      emitItemImportEvent({
        type: "error",
        code: error.code || "ITEM_IMPORT_FAILED",
        message: error.message || "无法处理 BOOTH 下载链接。"
      });
    });
  }
}

function isAllowedBoothHost(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return normalized === "booth.pm" || normalized.endsWith(".booth.pm");
}

function isAllowedDownloadUrl(url) {
  if (url.protocol === "https:" && isAllowedBoothHost(url.hostname)) return true;
  const testOrigin = !app.isPackaged && process.env.NODE_ENV === "test"
    ? String(process.env.ITEM_MANAGER_TEST_DOWNLOAD_ORIGIN || "")
    : "";
  return Boolean(testOrigin && url.origin === testOrigin);
}

function parseItemImportUrl(rawUrl) {
  let protocolUrl;
  try {
    protocolUrl = new URL(rawUrl);
  } catch {
    throw new ItemImportError("INVALID_ITEM_IMPORT_URL", "无法解析 item-import 链接。");
  }

  if (protocolUrl.protocol !== `${APP_PROTOCOL}:` || protocolUrl.hostname.toLowerCase() !== "item-import") {
    throw new ItemImportError("UNSUPPORTED_PROTOCOL_ACTION", "该链接不是受支持的 item-import 操作。");
  }

  const downloadUrlValue = protocolUrl.searchParams.get("dlurl") || "";
  const requestedFileName = protocolUrl.searchParams.get("downloadable_filename") || "";
  const itemId = protocolUrl.searchParams.get("item_id") || "";
  const orderId = protocolUrl.searchParams.get("order_id") || "";
  const variationId = protocolUrl.searchParams.get("variation_id") || "";

  if (!/^\d{1,12}$/.test(itemId)) {
    throw new ItemImportError("INVALID_ITEM_ID", "item-import 链接缺少有效的 BOOTH 商品编号。");
  }
  if (orderId && !/^\d{1,20}$/.test(orderId)) {
    throw new ItemImportError("INVALID_ORDER_ID", "item-import 链接中的订单编号无效。");
  }
  if (variationId && !/^\d{1,20}$/.test(variationId)) {
    throw new ItemImportError("INVALID_VARIATION_ID", "item-import 链接中的规格编号无效。");
  }

  let downloadUrl;
  try {
    downloadUrl = new URL(downloadUrlValue);
  } catch {
    throw new ItemImportError("INVALID_DOWNLOAD_URL", "item-import 链接缺少有效的下载地址。");
  }
  if (!isAllowedDownloadUrl(downloadUrl)) {
    throw new ItemImportError("UNTRUSTED_DOWNLOAD_URL", "仅允许从 BOOTH 的 HTTPS 地址下载文件。");
  }

  const fileName = sanitizeDownloadFileName(requestedFileName || path.basename(downloadUrl.pathname));
  return { downloadUrl: downloadUrlValue, fileName, itemId, orderId, variationId };
}

function sanitizeDownloadFileName(value) {
  let fileName = path.basename(String(value || "download"));
  fileName = fileName.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").replace(/[. ]+$/g, "").trim();
  if (!fileName) fileName = "download";

  const parsed = path.parse(fileName);
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(parsed.name)) {
    fileName = `_${fileName}`;
  }
  return fileName.slice(0, 240);
}

async function pathExists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

function waitFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function removePartialFile(target) {
  for (const delay of [0, 100, 250, 500, 1000, 2000]) {
    if (delay) await waitFor(delay);
    try {
      await fsp.rm(target, { force: true });
      if (!await pathExists(target)) return true;
    } catch {
      // Windows may briefly keep the response file open after a network failure.
    }
  }
  return false;
}

function schedulePartialFileCleanup(target) {
  let attemptsRemaining = 15;
  const retry = async () => {
    if (await removePartialFile(target) || attemptsRemaining <= 0) return;
    attemptsRemaining -= 1;
    setTimeout(retry, 2000);
  };
  setTimeout(retry, 2000);
}

function friendlyDownloadError(error) {
  if (error instanceof ItemImportError) return error.message;
  const message = String(error?.message || "");
  const causeCode = String(error?.cause?.code || "");
  if (/terminated/i.test(message) || /UND_ERR_(SOCKET|CONTENT_LENGTH_MISMATCH)/i.test(causeCode)) {
    return "下载连接意外中断，请重试。若下载链接已接近有效期，请从 BOOTH 获取新的链接。";
  }
  if (/fetch failed/i.test(message)) {
    return "无法连接到 BOOTH 下载服务器，请检查网络后重试。";
  }
  return message || "下载失败。";
}

function fitDownloadFileNameToDirectory(fileName, directory) {
  const maximumLength = Math.min(200, Math.max(32, 228 - directory.length));
  if (fileName.length <= maximumLength) return fileName;

  const parsed = path.parse(fileName);
  const extension = parsed.ext.slice(0, 20);
  const baseLength = Math.max(1, maximumLength - extension.length);
  return `${parsed.name.slice(0, baseLength)}${extension}`;
}

async function reserveDownloadDestination(directory, fileName) {
  const parsed = path.parse(fileName);
  let index = 0;

  while (true) {
    const suffix = index ? ` (${index})` : "";
    const candidate = path.join(directory, `${parsed.name}${suffix}${parsed.ext}`);
    const reservationKey = candidate.toLocaleLowerCase();
    if (!reservedDownloadPaths.has(reservationKey) && !await pathExists(candidate)) {
      reservedDownloadPaths.add(reservationKey);
      return { path: candidate, reservationKey };
    }
    index += 1;
  }
}

async function fetchBoothDownload(initialUrl, signal) {
  let target = initialUrl;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const response = await net.fetch(target, { redirect: "manual", signal });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location");
    if (!location) throw new ItemImportError("INVALID_DOWNLOAD_REDIRECT", "BOOTH 下载重定向缺少目标地址。");
    const redirected = new URL(location, target);
    if (!isAllowedDownloadUrl(redirected)) {
      throw new ItemImportError("UNTRUSTED_DOWNLOAD_REDIRECT", "BOOTH 下载重定向到了不受信任的地址。");
    }
    target = redirected.href;
  }
  throw new ItemImportError("TOO_MANY_DOWNLOAD_REDIRECTS", "BOOTH 下载重定向次数过多。");
}

async function createDownloadedItem(importRequest, localPath) {
  if (!serverOrigin) throw new Error("本地数据服务尚未准备完成。");
  const response = await fetch(`${serverOrigin}/api/booth-download-complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      itemId: importRequest.itemId,
      orderId: importRequest.orderId,
      variationId: importRequest.variationId,
      fileName: path.basename(localPath),
      localPath
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "无法创建下载条目。");
  return result;
}

async function startItemImport(rawUrl) {
  const importRequest = parseItemImportUrl(rawUrl);
  const downloadRoot = desktopSettings.downloadDirectory;
  if (!downloadRoot) {
    throw new ItemImportError("DOWNLOAD_DIRECTORY_REQUIRED", "请先在设置中选择文件下载保存目录。");
  }

  const resolvedRoot = path.resolve(downloadRoot);
  let rootStat;
  try {
    rootStat = await fsp.stat(resolvedRoot);
  } catch {
    throw new ItemImportError("DOWNLOAD_DIRECTORY_UNAVAILABLE", "设置的文件下载保存目录不存在或无法访问。");
  }
  if (!rootStat.isDirectory()) {
    throw new ItemImportError("DOWNLOAD_DIRECTORY_UNAVAILABLE", "设置的文件下载保存路径不是文件夹。");
  }

  const itemDirectory = path.join(resolvedRoot, `b${importRequest.itemId}`);
  await fsp.mkdir(itemDirectory, { recursive: true });
  const fittedFileName = fitDownloadFileNameToDirectory(importRequest.fileName, itemDirectory);
  const destination = await reserveDownloadDestination(itemDirectory, fittedFileName);
  const jobId = crypto.randomUUID();
  const temporaryPath = path.join(itemDirectory, `.${jobId}.part`);
  const controller = new AbortController();
  const downloadJob = {
    controller,
    cancelRequested: false,
    temporaryPath,
    destinationPath: destination.path,
    reservationKey: destination.reservationKey
  };
  activeDownloads.set(jobId, downloadJob);

  emitItemImportEvent({
    type: "started",
    jobId,
    itemId: importRequest.itemId,
    fileName: path.basename(destination.path),
    destinationPath: destination.path
  });

  let fileHandle = null;
  let responseReader = null;
  let downloadCompleted = false;
  try {
    const response = await fetchBoothDownload(importRequest.downloadUrl, controller.signal);
    if (!response.ok) {
      const message = response.status === 403
        ? "BOOTH 下载链接已失效或无权访问，请从 BOOTH 获取新的下载链接。"
        : `BOOTH 下载失败（HTTP ${response.status}）。`;
      throw new ItemImportError("DOWNLOAD_HTTP_ERROR", message);
    }
    if (!response.body) throw new ItemImportError("EMPTY_DOWNLOAD_RESPONSE", "BOOTH 没有返回可下载的文件内容。");

    const totalBytes = Number(response.headers.get("content-length")) || 0;
    let receivedBytes = 0;
    let lastProgressAt = 0;
    const downloadStartedAt = Date.now();
    fileHandle = await fsp.open(temporaryPath, "wx");
    responseReader = response.body.getReader();

    while (true) {
      const { done, value } = await responseReader.read();
      if (done) break;
      await fileHandle.write(value);
      receivedBytes += value.byteLength;
      const now = Date.now();
      if (now - lastProgressAt >= 100 || (totalBytes && receivedBytes >= totalBytes)) {
        lastProgressAt = now;
        const elapsedSeconds = Math.max(0.001, (now - downloadStartedAt) / 1000);
        emitItemImportEvent({
          type: "progress",
          jobId,
          receivedBytes,
          totalBytes,
          bytesPerSecond: Math.round(receivedBytes / elapsedSeconds)
        });
      }
    }

    responseReader = null;
    await fileHandle.close();
    fileHandle = null;
    await fsp.rename(temporaryPath, destination.path);
    downloadCompleted = true;
    emitItemImportEvent({ type: "finalizing", jobId, destinationPath: destination.path });

    let itemResult = null;
    let itemWarning = "";
    let completionHasError = false;
    try {
      itemResult = await createDownloadedItem(importRequest, destination.path);
      itemWarning = itemResult.skipped
        ? itemResult.message || "已存在相同条目，跳过创建"
        : itemResult.metadataWarning || "";
    } catch (error) {
      completionHasError = true;
      itemWarning = `文件已下载，但自动创建条目失败：${error.message}`;
    }

    emitItemImportEvent({
      type: "completed",
      jobId,
      destinationPath: destination.path,
      item: itemResult?.item || null,
      warning: itemWarning,
      completionHasError
    });
  } catch (error) {
    controller.abort();
    if (responseReader) await responseReader.cancel().catch(() => {});
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
      fileHandle = null;
    }
    if (!downloadCompleted) {
      const removed = await removePartialFile(temporaryPath);
      if (!removed) schedulePartialFileCleanup(temporaryPath);
    }

    if (controller.signal.aborted) {
      if (downloadJob.cancelRequested) {
        emitItemImportEvent({ type: "cancelled", jobId });
      } else {
        emitItemImportEvent({
          type: "error",
          jobId,
          code: error.code || "DOWNLOAD_FAILED",
          message: friendlyDownloadError(error)
        });
      }
    } else {
      emitItemImportEvent({
        type: "error",
        jobId,
        code: error.code || "DOWNLOAD_FAILED",
        message: friendlyDownloadError(error)
      });
    }
  } finally {
    activeDownloads.delete(jobId);
    reservedDownloadPaths.delete(destination.reservationKey);
  }
}

function restoreMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function executableDirectory() {
  return app.isPackaged
    ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath))
    : __dirname;
}

function archiveDirectory() {
  return process.env.ITEM_MANAGER_DATA_DIR
    ? path.resolve(process.env.ITEM_MANAGER_DATA_DIR)
    : path.join(executableDirectory(), "data");
}

function readDesktopSettings() {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(archiveDirectory(), "settings.json"), "utf8"));
    return cleanDesktopSettings(settings);
  } catch {
    return { ...DEFAULT_DESKTOP_SETTINGS };
  }
}

function syncProtocolRegistration() {
  if (!app.isPackaged) {
    return { supported: false, registered: false };
  }

  if (desktopSettings.associateProtocol) {
    app.setAsDefaultProtocolClient(APP_PROTOCOL);
  } else if (app.isDefaultProtocolClient(APP_PROTOCOL)) {
    app.removeAsDefaultProtocolClient(APP_PROTOCOL);
  }

  return {
    supported: true,
    registered: app.isDefaultProtocolClient(APP_PROTOCOL)
  };
}

function closeDevTools() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.isDevToolsOpened()) {
    mainWindow.webContents.closeDevTools();
  }
  if (devToolsWindow && !devToolsWindow.isDestroyed()) {
    devToolsWindow.destroy();
  }
  devToolsWindow = null;
}

function applyDesktopSettings(settings) {
  desktopSettings = cleanDesktopSettings(settings);
  if (!desktopSettings.allowDevTools) closeDevTools();
  return {
    ...desktopSettings,
    protocol: syncProtocolRegistration()
  };
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

ipcMain.handle("apply-desktop-settings", (_event, settings) => applyDesktopSettings(settings));

ipcMain.handle("cancel-item-download", (_event, jobId) => {
  const job = activeDownloads.get(String(jobId || ""));
  if (!job) return { cancelled: false };
  job.cancelRequested = true;
  job.controller.abort();
  return { cancelled: true };
});

ipcMain.on("item-import-renderer-ready", (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  rendererReadyForImports = true;
  flushProtocolUrls();
});

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
  const started = await startServer(0, {
    fetchImpl: (input, init) => net.fetch(input, init)
  });
  server = started.server;
  serverOrigin = `http://127.0.0.1:${started.port}`;

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
  mainWindow = window;

  rendererReadyForImports = false;
  await window.loadURL(serverOrigin);
  if (pendingProtocolUrls.length) restoreMainWindow();

  function handleDevToolsShortcut(event, input) {
    const isShortcut = input.key === "F12" ||
      (input.control && input.shift && String(input.key).toLowerCase() === "i");
    if (input.type !== "keyDown" || !isShortcut || input.isAutoRepeat) return;

    event.preventDefault();
    if (!desktopSettings.allowDevTools) return;
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
  window.once("closed", () => {
    closeDevTools();
    rendererReadyForImports = false;
    if (mainWindow === window) mainWindow = null;
  });
}

configurePortableProfile();

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    const protocolUrl = findProtocolUrl(commandLine);
    if (protocolUrl) enqueueProtocolUrl(protocolUrl);
    else restoreMainWindow();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    enqueueProtocolUrl(url);
  });

  app.whenReady().then(() => {
    desktopSettings = readDesktopSettings();
    applyDesktopSettings(desktopSettings);
    return createWindow();
  }).catch((error) => {
    dialog.showErrorBox("Item Manager failed to start", error.stack || error.message);
    app.quit();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  for (const job of activeDownloads.values()) job.controller.abort();
  if (server) server.close();
});
