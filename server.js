const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { fileURLToPath } = require("url");
const { spawn, execFile } = require("child_process");

const ROOT = __dirname;
// Electron can supply a writable archive directory beside its executable.
const DATA_DIR = path.resolve(process.env.ITEM_MANAGER_DATA_DIR || path.join(ROOT, "data"));
const PUBLIC_DIR = path.join(ROOT, "public");
const IMAGE_DIR = path.join(ROOT, "image");
const DB_FILE = path.join(DATA_DIR, "items.json");
const TAGS_FILE = path.join(DATA_DIR, "tags.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const PORT = Number(process.env.PORT || 4177);
const DEFAULT_TAG_COLORS = {
  backgroundColor: "#202633",
  textColor: "#bfd0df",
  borderColor: "#2a3140"
};
const DEFAULT_SETTINGS = {
  coverRatio: "1 / 1",
  cardSize: "280px"
};
const ALLOWED_COVER_RATIOS = new Set(["1 / 1", "4 / 3", "16 / 9"]);
const ALLOWED_CARD_SIZES = new Set(["220px", "280px", "360px"]);
const LEGACY_COLUMN_SIZES = {
  small: "220px",
  medium: "280px",
  large: "360px"
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const importJobs = new Map();
const BOOTH_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";

async function ensureStore() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(DB_FILE);
  } catch {
    await fsp.writeFile(DB_FILE, "[]\n", "utf8");
  }
  try {
    await fsp.access(TAGS_FILE);
  } catch {
    const items = JSON.parse(await fsp.readFile(DB_FILE, "utf8"));
    const names = [...new Set(items.flatMap((item) => item.tags || []))].sort((a, b) => a.localeCompare(b));
    const tags = names.map((name) => ({
      id: crypto.randomUUID(),
      name,
      ...DEFAULT_TAG_COLORS,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
    await fsp.writeFile(TAGS_FILE, `${JSON.stringify(tags, null, 2)}\n`, "utf8");
  }
  try {
    await fsp.access(SETTINGS_FILE);
  } catch {
    await writeSettings(DEFAULT_SETTINGS);
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readItems() {
  await ensureStore();
  return JSON.parse(await fsp.readFile(DB_FILE, "utf8"));
}

async function writeItems(items) {
  await fsp.writeFile(DB_FILE, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

async function readTags() {
  await ensureStore();
  return JSON.parse(await fsp.readFile(TAGS_FILE, "utf8"));
}

async function writeTags(tags) {
  await fsp.writeFile(TAGS_FILE, `${JSON.stringify(tags, null, 2)}\n`, "utf8");
}

function cleanSettings(input = {}) {
  const legacyCardSize = LEGACY_COLUMN_SIZES[input.columnSize];
  const coverRatio = ALLOWED_COVER_RATIOS.has(input.coverRatio)
    ? input.coverRatio
    : DEFAULT_SETTINGS.coverRatio;
  const cardSize = ALLOWED_CARD_SIZES.has(input.cardSize)
    ? input.cardSize
    : legacyCardSize || DEFAULT_SETTINGS.cardSize;

  return { coverRatio, cardSize };
}

async function readSettings() {
  await ensureStore();
  try {
    return cleanSettings(JSON.parse(await fsp.readFile(SETTINGS_FILE, "utf8")));
  } catch {
    await writeSettings(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
}

async function writeSettings(settings) {
  const clean = cleanSettings(settings);
  await fsp.writeFile(SETTINGS_FILE, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
  return clean;
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function localImagePathFromQuery(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^file:\/\//i.test(raw)) return fileURLToPath(raw);
  return path.resolve(raw);
}

function cleanItem(input, existing = {}) {
  const now = new Date().toISOString();
  return {
    id: existing.id || crypto.randomUUID(),
    title: String(input.title || "").trim() || "Untitled Item",
    creator: String(input.creator || "").trim(),
    url: String(input.url || "").trim(),
    localPath: String(input.localPath || "").trim(),
    tags: Array.isArray(input.tags)
      ? input.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : String(input.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
    notes: String(input.notes || "").trim(),
    coverMode: input.coverMode === "url" ? "url" : "local",
    coverUrl: String(input.coverUrl || "").trim(),
    coverPath: String(input.coverPath || "").trim(),
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

function hasDuplicateTitle(items, title, currentId = null) {
  const normalizedTitle = String(title || "").trim().toLocaleLowerCase();
  return items.some((item) => (
    item.id !== currentId &&
    String(item.title || "").trim().toLocaleLowerCase() === normalizedTitle
  ));
}

function titleKey(title) {
  return String(title || "").trim().toLocaleLowerCase();
}

function uniqueTitle(baseTitle, usedTitles) {
  const base = String(baseTitle || "").trim() || "Untitled Item";
  let title = base;
  let index = 2;
  while (usedTitles.has(titleKey(title))) {
    title = `${base} (${index})`;
    index += 1;
  }
  usedTitles.add(titleKey(title));
  return title;
}

function firstBoothValue(data, paths) {
  for (const keys of paths) {
    let value = data;
    for (const key of keys) {
      value = value && typeof value === "object" ? value[key] : null;
      if (value == null) break;
    }
    if (value != null && value !== "" && (!Array.isArray(value) || value.length)) return value;
  }
  return null;
}

function boothImageUrl(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.length ? boothImageUrl(value[0]) : "";
  if (value && typeof value === "object") {
    return firstBoothValue(value, [["original"], ["url"], ["src"], ["resized"]]) || "";
  }
  return "";
}

function parseBoothItem(data, itemId) {
  for (const key of ["item", "shop_item", "product", "data"]) {
    if (data?.[key] && typeof data[key] === "object") {
      data = data[key];
      break;
    }
  }

  const title = firstBoothValue(data, [["name"], ["title"]]);
  const creator = firstBoothValue(data, [
    ["shop", "name"],
    ["shop", "title"],
    ["shop_name"],
    ["seller", "name"]
  ]);
  const coverUrl = boothImageUrl(firstBoothValue(data, [
    ["images"],
    ["image"],
    ["main_image"],
    ["thumbnail"]
  ]));

  if (![title, creator, coverUrl].every((value) => typeof value === "string" && value.trim())) return null;
  return {
    id: Number(itemId),
    title: title.trim(),
    creator: creator.trim(),
    coverUrl: coverUrl.trim(),
    url: `https://booth.pm/zh-cn/items/${itemId}`
  };
}

async function scrapeBoothItem(itemId) {
  const normalizedId = String(itemId || "").trim();
  if (!/^\d{1,12}$/.test(normalizedId)) throw new Error("无法从输入内容中识别 Booth 商品编号。");

  let lastError = null;
  for (const locale of ["zh-cn", "ja"]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`https://booth.pm/${locale}/items/${normalizedId}.json`, {
        headers: {
          "User-Agent": BOOTH_USER_AGENT,
          "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8",
          Accept: "application/json"
        },
        redirect: "follow",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const item = parseBoothItem(await response.json(), normalizedId);
      if (item) return item;
      lastError = new Error("Booth 返回的数据缺少名称、作者或封面。");
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError?.name === "AbortError") throw new Error("连接 Booth 超时，请稍后重试。");
  throw new Error(lastError?.message || "无法读取 Booth 商品信息。");
}

function publicImportJob(job) {
  return {
    id: job.id,
    status: job.status,
    rootPath: job.rootPath,
    currentPath: job.currentPath,
    discovered: job.discovered,
    processed: job.processed,
    created: job.created,
    skipped: job.skipped,
    pending: job.pending,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt
  };
}

async function runImportJob(job) {
  job.status = "running";
  job.startedAt = new Date().toISOString();

  try {
    const rootStat = await fsp.stat(job.rootPath);
    if (!rootStat.isDirectory()) throw new Error("Selected path is not a folder.");

    const items = await readItems();
    const usedTitles = new Set(items.map((item) => titleKey(item.title)));
    const importedItems = [];
    job.currentPath = job.rootPath;

    const entries = await fsp.readdir(job.rootPath, { withFileTypes: true });
    job.discovered = entries.length;

    for (const entry of entries) {
      const fullPath = path.join(job.rootPath, entry.name);
      const isDirectory = entry.isDirectory();
      const isFile = entry.isFile();

      if (!isDirectory && !isFile) {
        job.skipped += 1;
        job.processed += 1;
        continue;
      }

      importedItems.push(cleanItem({
        title: uniqueTitle(entry.name, usedTitles),
        localPath: fullPath,
        coverMode: "url"
      }));
      job.created += 1;
      job.processed += 1;

      if (job.processed % 100 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    if (importedItems.length) {
      items.push(...importedItems);
      await writeItems(items);
    }

    job.status = "complete";
    job.currentPath = "";
    job.pending = 0;
    job.finishedAt = new Date().toISOString();
  } catch (error) {
    job.status = "error";
    job.error = error.message || "Import failed.";
    job.finishedAt = new Date().toISOString();
  }
}

function startImportJob(rootPath) {
  const job = {
    id: crypto.randomUUID(),
    status: "queued",
    rootPath: path.resolve(String(rootPath || "")),
    currentPath: "",
    discovered: 0,
    processed: 0,
    created: 0,
    skipped: 0,
    pending: 0,
    error: "",
    startedAt: "",
    finishedAt: ""
  };
  importJobs.set(job.id, job);
  runImportJob(job);
  return job;
}

function cleanTag(input, existing = {}) {
  const now = new Date().toISOString();
  return {
    id: existing.id || crypto.randomUUID(),
    name: String(input.name || "").trim(),
    backgroundColor: String(input.backgroundColor || DEFAULT_TAG_COLORS.backgroundColor).trim(),
    textColor: String(input.textColor || DEFAULT_TAG_COLORS.textColor).trim(),
    borderColor: String(input.borderColor || DEFAULT_TAG_COLORS.borderColor).trim(),
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

function hasDuplicateTag(tags, name, currentId = null) {
  const normalizedName = String(name || "").trim().toLocaleLowerCase();
  return tags.some((tag) => (
    tag.id !== currentId &&
    String(tag.name || "").trim().toLocaleLowerCase() === normalizedName
  ));
}

function openExternal(target) {
  if (!target) return false;
  spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" }).unref();
  return true;
}

function revealPath(target) {
  if (!target) return false;
  const normalized = path.normalize(target);
  if (!fs.existsSync(normalized)) return false;
  if (fs.statSync(normalized).isFile()) {
    spawn("explorer.exe", ["/select,", normalized], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("explorer.exe", [normalized], { detached: true, stdio: "ignore" }).unref();
  }
  return true;
}

function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", command],
      { windowsHide: false },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

async function pickLocalPath(kind) {
  if (kind === "folder") {
    return runPowerShell(
      "Add-Type -AssemblyName System.Windows.Forms; " +
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
      "$d.Description = '选择本地文件夹'; " +
      "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath }"
    );
  }

  return runPowerShell(
    "Add-Type -AssemblyName System.Windows.Forms; " +
    "$d = New-Object System.Windows.Forms.OpenFileDialog; " +
    `$d.Title = '${kind === "image" ? "选择封面图片" : "选择本地文件"}'; ` +
    (kind === "image"
      ? "$d.Filter = '图片文件|*.png;*.jpg;*.jpeg;*.webp;*.gif;*.svg|所有文件|*.*'; "
      : "") +
    "$d.CheckFileExists = $true; " +
    "$d.Multiselect = $false; " +
    "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileName }"
  );
}

async function handleApi(req, res, url) {
  try {
    if (url.pathname === "/api/items" && req.method === "GET") {
      return send(res, 200, await readItems());
    }

    if (url.pathname === "/api/booth-import" && req.method === "POST") {
      const { itemId } = await readJson(req);
      try {
        return send(res, 200, await scrapeBoothItem(itemId));
      } catch (error) {
        return send(res, 502, { error: error.message || "无法读取 Booth 商品信息。" });
      }
    }

    if (url.pathname === "/api/items" && req.method === "POST") {
      const body = await readJson(req);
      const items = await readItems();
      const item = cleanItem(body);
      if (hasDuplicateTitle(items, item.title)) {
        return send(res, 409, { error: "Title already exists." });
      }
      items.push(item);
      await writeItems(items);
      return send(res, 201, item);
    }

    const itemMatch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (itemMatch && req.method === "PUT") {
      const body = await readJson(req);
      const items = await readItems();
      const index = items.findIndex((item) => item.id === itemMatch[1]);
      if (index === -1) return send(res, 404, { error: "Item not found." });
      const item = cleanItem(body, items[index]);
      if (hasDuplicateTitle(items, item.title, item.id)) {
        return send(res, 409, { error: "Title already exists." });
      }
      items[index] = item;
      await writeItems(items);
      return send(res, 200, items[index]);
    }

    if (itemMatch && req.method === "DELETE") {
      const items = await readItems();
      const nextItems = items.filter((item) => item.id !== itemMatch[1]);
      await writeItems(nextItems);
      return send(res, 200, { ok: true });
    }

    if (url.pathname === "/api/tags" && req.method === "GET") {
      return send(res, 200, await readTags());
    }

    if (url.pathname === "/api/settings" && req.method === "GET") {
      return send(res, 200, await readSettings());
    }

    if (url.pathname === "/api/settings" && req.method === "PUT") {
      return send(res, 200, await writeSettings(await readJson(req)));
    }

    if (url.pathname === "/api/tags" && req.method === "POST") {
      const body = await readJson(req);
      const tags = await readTags();
      const tag = cleanTag(body);
      if (!tag.name) return send(res, 400, { error: "Tag name is required." });
      if (hasDuplicateTag(tags, tag.name)) return send(res, 409, { error: "Tag already exists." });
      tags.push(tag);
      await writeTags(tags);
      return send(res, 201, tag);
    }

    if (url.pathname === "/api/tags/order" && req.method === "PUT") {
      const body = await readJson(req);
      const tags = await readTags();
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      const uniqueIds = new Set(ids);
      const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
      const hasInvalidIds = (
        ids.length !== tags.length ||
        uniqueIds.size !== ids.length ||
        ids.some((id) => !tagsById.has(id))
      );
      if (hasInvalidIds) return send(res, 400, { error: "Tag order must contain every tag exactly once." });
      const orderedTags = ids.map((id) => tagsById.get(id));
      await writeTags(orderedTags);
      return send(res, 200, orderedTags);
    }

    const tagMatch = url.pathname.match(/^\/api\/tags\/([^/]+)$/);
    if (tagMatch && req.method === "PUT") {
      const body = await readJson(req);
      const tags = await readTags();
      const index = tags.findIndex((tag) => tag.id === tagMatch[1]);
      if (index === -1) return send(res, 404, { error: "Tag not found." });
      const tag = cleanTag(body, tags[index]);
      if (!tag.name) return send(res, 400, { error: "Tag name is required." });
      if (hasDuplicateTag(tags, tag.name, tag.id)) return send(res, 409, { error: "Tag already exists." });
      const oldName = tags[index].name;
      tags[index] = tag;
      if (oldName !== tag.name) {
        const items = await readItems();
        const nextItems = items.map((item) => ({
          ...item,
          tags: (item.tags || []).map((name) => name === oldName ? tag.name : name)
        }));
        await writeItems(nextItems);
      }
      await writeTags(tags);
      return send(res, 200, tag);
    }

    if (tagMatch && req.method === "DELETE") {
      const tags = await readTags();
      const tag = tags.find((entry) => entry.id === tagMatch[1]);
      if (!tag) return send(res, 404, { error: "Tag not found." });
      await writeTags(tags.filter((entry) => entry.id !== tag.id));
      const items = await readItems();
      await writeItems(items.map((item) => ({
        ...item,
        tags: (item.tags || []).filter((name) => name !== tag.name)
      })));
      return send(res, 200, { ok: true });
    }

    if (url.pathname === "/api/open-url" && req.method === "POST") {
      const { url: target } = await readJson(req);
      if (!/^https?:\/\//i.test(String(target || ""))) {
        return send(res, 400, { error: "Only http and https links can be opened." });
      }
      return send(res, 200, { ok: openExternal(target) });
    }

    if (url.pathname === "/api/reveal-path" && req.method === "POST") {
      const { localPath } = await readJson(req);
      if (!localPath) return send(res, 400, { error: "Path is required." });
      if (!revealPath(localPath)) return send(res, 404, { error: "Path does not exist." });
      return send(res, 200, { ok: true });
    }

    if (url.pathname === "/api/import-folder" && req.method === "POST") {
      const { rootPath } = await readJson(req);
      if (!rootPath) return send(res, 400, { error: "Folder path is required." });
      return send(res, 202, publicImportJob(startImportJob(rootPath)));
    }

    const importMatch = url.pathname.match(/^\/api\/import-folder\/([^/]+)$/);
    if (importMatch && req.method === "GET") {
      const job = importJobs.get(importMatch[1]);
      if (!job) return send(res, 404, { error: "Import job not found." });
      return send(res, 200, publicImportJob(job));
    }

    if (url.pathname === "/api/pick-path" && req.method === "POST") {
      const { kind } = await readJson(req);
      if (kind !== "file" && kind !== "folder" && kind !== "image") {
        return send(res, 400, { error: "Picker kind must be file, folder, or image." });
      }
      const localPath = await pickLocalPath(kind);
      return send(res, 200, { localPath });
    }

    return send(res, 404, { error: "Not found." });
  } catch (error) {
    return send(res, 500, { error: error.message || "Server error." });
  }
}

async function serveStatic(req, res, url) {
  let filePath;
  if (url.pathname.startsWith("/image/")) {
    filePath = path.join(IMAGE_DIR, decodeURIComponent(url.pathname.slice("/image/".length)));
  } else {
    const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    filePath = path.join(PUBLIC_DIR, requested);
  }

  const root = url.pathname.startsWith("/image/")
      ? IMAGE_DIR
      : PUBLIC_DIR;
  if (!path.resolve(filePath).startsWith(path.resolve(root))) {
    return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  }

  try {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

async function serveLocalCover(req, res, url) {
  let filePath;
  try {
    filePath = localImagePathFromQuery(url.searchParams.get("path"));
  } catch {
    return send(res, 400, "Invalid local image path.", "text/plain; charset=utf-8");
  }

  if (!filePath) return send(res, 400, "Local image path is required.", "text/plain; charset=utf-8");

  const type = MIME[path.extname(filePath).toLowerCase()];
  if (!IMAGE_MIME_TYPES.has(type)) {
    return send(res, 415, "Unsupported image type.", "text/plain; charset=utf-8");
  }

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    const data = await fsp.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": data.length,
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

function createAppServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
    if (url.pathname === "/local-cover") return serveLocalCover(req, res, url);
    return serveStatic(req, res, url);
  });

  return server;
}

async function startServer(port = PORT) {
  await ensureStore();
  const server = createAppServer();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const activePort = typeof address === "object" && address ? address.port : port;
  console.log(`Item Manager is running at http://127.0.0.1:${activePort}`);
  console.log(`All archive data is stored under ${DATA_DIR}`);
  return { server, port: activePort };
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { startServer };
