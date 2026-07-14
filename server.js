const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");
const COVER_DIR = path.join(DATA_DIR, "covers");
const DB_FILE = path.join(DATA_DIR, "items.json");
const TAGS_FILE = path.join(DATA_DIR, "tags.json");
const PORT = Number(process.env.PORT || 4177);
const DEFAULT_TAG_COLORS = {
  backgroundColor: "#202633",
  textColor: "#bfd0df",
  borderColor: "#2a3140"
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

async function ensureStore() {
  await fsp.mkdir(COVER_DIR, { recursive: true });
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

function send(res, status, body, type = "application/json; charset=utf-8") {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
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
    "$d.Title = '选择本地文件'; " +
    "$d.CheckFileExists = $true; " +
    "$d.Multiselect = $false; " +
    "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileName }"
  );
}

async function copyCover(sourcePath) {
  const normalized = path.normalize(String(sourcePath || ""));
  const stat = await fsp.stat(normalized);
  if (!stat.isFile()) throw new Error("Cover path is not a file.");
  const ext = path.extname(normalized).toLowerCase() || ".img";
  const name = `${crypto.randomUUID()}${ext}`;
  const dest = path.join(COVER_DIR, name);
  await fsp.copyFile(normalized, dest);
  return `/covers/${name}`;
}

async function handleApi(req, res, url) {
  try {
    if (url.pathname === "/api/items" && req.method === "GET") {
      return send(res, 200, await readItems());
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

    if (url.pathname === "/api/pick-path" && req.method === "POST") {
      const { kind } = await readJson(req);
      if (kind !== "file" && kind !== "folder") {
        return send(res, 400, { error: "Picker kind must be file or folder." });
      }
      const localPath = await pickLocalPath(kind);
      return send(res, 200, { localPath });
    }

    if (url.pathname === "/api/copy-cover" && req.method === "POST") {
      const { coverPath } = await readJson(req);
      return send(res, 200, { coverPath: await copyCover(coverPath) });
    }

    return send(res, 404, { error: "Not found." });
  } catch (error) {
    return send(res, 500, { error: error.message || "Server error." });
  }
}

async function serveStatic(req, res, url) {
  let filePath;
  if (url.pathname.startsWith("/covers/")) {
    filePath = path.join(COVER_DIR, decodeURIComponent(url.pathname.slice("/covers/".length)));
  } else {
    const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    filePath = path.join(PUBLIC_DIR, requested);
  }

  const root = url.pathname.startsWith("/covers/") ? COVER_DIR : PUBLIC_DIR;
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

ensureStore().then(() => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
    return serveStatic(req, res, url);
  });

  server.listen(PORT, () => {
    console.log(`Item Manager is running at http://localhost:${PORT}`);
    console.log(`All project data is stored under ${ROOT}`);
  });
});
