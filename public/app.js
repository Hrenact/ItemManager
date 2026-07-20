const DEFAULT_TAG_COLORS = {
  backgroundColor: "#202633",
  textColor: "#bfd0df",
  borderColor: "#2a3140"
};

const state = {
  items: [],
  tags: [],
  editingId: null,
  editingTagId: null,
  selectedTags: new Set(),
  activeTagFilters: new Set(),
  pendingMessageResolve: null
};

const VIEW_SETTINGS_KEY = "item-manager-view-settings";
const DEFAULT_VIEW_SETTINGS = { coverRatio: "1 / 1", cardSize: "280px" };

const $ = (selector) => document.querySelector(selector);

const grid = $("#itemsGrid");
const dialog = $("#itemDialog");
const form = $("#itemForm");
const tagDialog = $("#tagDialog");
const tagForm = $("#tagForm");
const messageDialog = $("#messageDialog");
const emptyState = $("#emptyState");
const content = $(".content");
const scrollTopButton = $("#scrollTopButton");
const colorPopover = $("#colorPopover");
const colorField = $("#colorField");
const colorHueRange = $("#colorHueRange");
const colorPopoverPreview = $("#colorPopoverPreview");
let dragDepth = 0;
let activeColorInputId = null;
let activeHsv = { h: 0, s: 0, v: 1 };
let isPickingColorField = false;
let importPollTimer = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function showMessage(message, { title = "提示", confirm = false } = {}) {
  $("#messageTitle").textContent = title;
  $("#messageBody").textContent = message;
  $("#messageCancelButton").hidden = !confirm;
  $("#messageOkButton").textContent = confirm ? "确定" : "知道了";
  messageDialog.showModal();
  return new Promise((resolve) => {
    state.pendingMessageResolve = resolve;
  });
}

function resolveMessage(value) {
  if (state.pendingMessageResolve) state.pendingMessageResolve(value);
  state.pendingMessageResolve = null;
  messageDialog.close();
}

function notify(message) {
  return showMessage(message);
}

function ask(message) {
  return showMessage(message, { title: "确认", confirm: true });
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function tagStyle(name) {
  const tag = state.tags.find((entry) => entry.name === name);
  const colors = tag || DEFAULT_TAG_COLORS;
  return `background-color:${colors.backgroundColor};color:${colors.textColor};border-color:${colors.borderColor}`;
}

function coverFor(item) {
  const source = item.coverMode === "url" ? item.coverUrl : item.coverPath;
  if (!source) return `<div class="cover cover-placeholder" aria-label="未设置封面">?</div>`;
  const imageSource = item.coverMode === "url"
    ? source
    : `/local-cover?path=${encodeURIComponent(source)}`;
  return `<img class="cover" src="${escapeHtml(imageSource)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'), { className: 'cover cover-placeholder', textContent: '?' }))" />`;
}

function loadLocalViewSettings() {
  try {
    return { ...DEFAULT_VIEW_SETTINGS, ...JSON.parse(localStorage.getItem(VIEW_SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_VIEW_SETTINGS };
  }
}

async function saveViewSettings() {
  const settings = {
    coverRatio: $("#coverRatioSelect").value,
    cardSize: $("#cardSizeSelect").value
  };
  localStorage.setItem(VIEW_SETTINGS_KEY, JSON.stringify(settings));
  return api("/api/settings", {
    method: "PUT",
    body: JSON.stringify(settings)
  });
}

function applyViewSettings(settings = DEFAULT_VIEW_SETTINGS) {
  $("#coverRatioSelect").value = settings.coverRatio;
  $("#cardSizeSelect").value = settings.cardSize;
  document.documentElement.style.setProperty("--cover-ratio", settings.coverRatio);
  document.documentElement.style.setProperty("--card-min", settings.cardSize);
  syncCustomSelects();
}

function closeCustomSelects(except = null) {
  document.querySelectorAll(".select-menu").forEach((menu) => {
    if (menu === except) return;
    menu.hidden = true;
    menu.previousElementSibling?.setAttribute("aria-expanded", "false");
  });
}

function syncCustomSelect(select) {
  const field = select.closest(".select-field");
  const trigger = field?.querySelector(".select-trigger");
  const menu = field?.querySelector(".select-menu");
  if (!field || !trigger || !menu) return;

  const selectedOption = select.selectedOptions[0] || select.options[0];
  trigger.textContent = selectedOption?.textContent || "";
  [...menu.children].forEach((button) => {
    const selected = button.dataset.value === select.value;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", String(selected));
  });
}

function syncCustomSelects() {
  document.querySelectorAll(".select-field select").forEach(syncCustomSelect);
}

function initCustomSelects() {
  document.querySelectorAll(".select-field select").forEach((select) => {
    if (select.dataset.customSelectReady) return;
    select.dataset.customSelectReady = "true";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.title = select.title || "";

    const menu = document.createElement("div");
    menu.className = "select-menu";
    menu.setAttribute("role", "listbox");
    menu.hidden = true;

    [...select.options].forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "select-option";
      button.dataset.value = option.value;
      button.setAttribute("role", "option");
      button.textContent = option.textContent;
      button.addEventListener("click", () => {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        closeCustomSelects();
        syncCustomSelect(select);
      });
      menu.append(button);
    });

    trigger.addEventListener("click", () => {
      const willOpen = menu.hidden;
      closeCustomSelects(menu);
      menu.hidden = !willOpen;
      trigger.setAttribute("aria-expanded", String(willOpen));
    });

    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeCustomSelects();
      }
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        closeCustomSelects(menu);
        menu.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        menu.querySelector(".is-selected")?.focus();
      }
    });

    select.after(trigger, menu);
    syncCustomSelect(select);
  });
}

function getFilteredItems() {
  const query = $("#searchInput").value.trim().toLowerCase();
  return state.items.filter((item) => {
    const haystack = [item.title, item.creator, item.url, item.localPath, item.notes, ...(item.tags || [])]
      .join(" ")
      .toLowerCase();
    const matchesQuery = haystack.includes(query);
    const matchesTags = [...state.activeTagFilters].every((tag) => (item.tags || []).includes(tag));
    return matchesQuery && matchesTags;
  });
}

function renderItems() {
  const items = getFilteredItems();
  $("#totalCount").textContent = state.items.length;
  $("#shownCount").textContent = items.length;
  emptyState.classList.toggle("visible", items.length === 0);
  grid.innerHTML = items.map((item) => `
    <article class="card" data-id="${item.id}" title="编辑 ${escapeHtml(item.title)}">
      ${coverFor(item)}
      <div class="card-body">
        <h3>${escapeHtml(item.title)}</h3>
        <p class="meta">${escapeHtml(item.creator || "未设置作者")}</p>
        <div class="tags">
          ${(item.tags || []).slice(0, 5).map((tag) => `<span class="tag" style="${tagStyle(tag)}" title="标签：${escapeHtml(tag)}">${escapeHtml(tag)}</span>`).join("")}
        </div>
        <div class="card-actions">
          <button data-action="open" title="打开 ${escapeHtml(item.title)} 的网页链接">网页</button>
          <button data-action="reveal" title="在资源管理器中定位 ${escapeHtml(item.title)}">路径</button>
        </div>
      </div>
    </article>
  `).join("");
}

function renderSidebarTags() {
  const sidebarTags = $("#sidebarTags");
  sidebarTags.innerHTML = state.tags.length
    ? state.tags.map((tag) => `
      <label class="filter-tag ${state.activeTagFilters.has(tag.name) ? "active" : ""}" style="${tagStyle(tag.name)}" title="筛选标签：${escapeHtml(tag.name)}">
        <input type="checkbox" value="${escapeHtml(tag.name)}" ${state.activeTagFilters.has(tag.name) ? "checked" : ""} />
        ${escapeHtml(tag.name)}
      </label>
    `).join("")
    : `<span class="muted">暂无标签</span>`;
  $("#clearTagFiltersButton").hidden = state.activeTagFilters.size === 0;
}

function renderTagPicker() {
  const picker = $("#tagPicker");
  picker.innerHTML = state.tags.length
    ? state.tags.map((tag) => `
      <label class="tag-choice" style="${tagStyle(tag.name)}" title="为条目切换标签：${escapeHtml(tag.name)}">
        <input type="checkbox" value="${escapeHtml(tag.name)}" ${state.selectedTags.has(tag.name) ? "checked" : ""} />
        ${escapeHtml(tag.name)}
      </label>
    `).join("")
    : `<span class="muted">请先在左侧新建标签</span>`;
}

function renderTagManager() {
  const list = $("#tagManagerList");
  list.innerHTML = state.tags.length
    ? state.tags.map((tag) => `
      <button type="button" class="tag-manager-item ${tag.id === state.editingTagId ? "active" : ""}" data-id="${tag.id}" title="编辑标签：${escapeHtml(tag.name)}">
        <span class="tag" style="${tagStyle(tag.name)}" title="标签：${escapeHtml(tag.name)}">${escapeHtml(tag.name)}</span>
      </button>
    `).join("")
    : `<p class="muted">暂无标签</p>`;
  updateTagPreview();
}

function renderAll() {
  renderSidebarTags();
  renderTagPicker();
  renderTagManager();
  renderItems();
}

function readForm() {
  const coverMode = new FormData(form).get("coverMode") || "url";
  return {
    title: $("#titleInput").value,
    creator: $("#creatorInput").value,
    url: $("#urlInput").value,
    localPath: $("#pathInput").value,
    tags: [...state.selectedTags],
    coverMode,
    coverUrl: $("#coverUrlInput").value,
    coverPath: $("#coverPathInput").value,
    notes: $("#notesInput").value
  };
}

function hasDuplicateTitle(title, currentId = null) {
  const normalizedTitle = title.trim().toLocaleLowerCase();
  return state.items.some((item) => (
    item.id !== currentId &&
    item.title.trim().toLocaleLowerCase() === normalizedTitle
  ));
}

function setCoverMode(mode) {
  const select = $("#coverModeSelect");
  select.value = mode;
  syncCustomSelect(select);
  $("#coverUrlGroup").hidden = mode !== "url";
  $("#coverPathGroup").hidden = mode !== "local";
  updateCoverPreview();
}

function updateCoverPreview() {
  const mode = new FormData(form).get("coverMode") || "url";
  const source = (mode === "url" ? $("#coverUrlInput").value : $("#coverPathInput").value).trim();
  const image = $("#coverPreviewImage");
  const empty = $("#coverPreviewEmpty");

  if (!source) {
    image.hidden = true;
    image.removeAttribute("src");
    empty.hidden = false;
    return;
  }

  image.hidden = false;
  empty.hidden = true;
  image.src = mode === "url" ? source : `/local-cover?path=${encodeURIComponent(source)}`;
}

function openDialog(item = null) {
  state.editingId = item?.id || null;
  state.selectedTags = new Set(item?.tags || []);
  $("#dialogTitle").textContent = item ? "编辑条目" : "新建条目";
  $("#deleteButton").hidden = !item;
  $("#titleInput").value = item?.title || "";
  $("#creatorInput").value = item?.creator || "";
  $("#urlInput").value = item?.url || "";
  $("#pathInput").value = item?.localPath || "";
  $("#coverUrlInput").value = item?.coverUrl || "";
  $("#coverPathInput").value = item?.coverPath || "";
  $("#notesInput").value = item?.notes || "";
  setCoverMode(item?.coverMode || "url");
  renderTagPicker();
  dialog.showModal();
}

function selectTag(tag = null) {
  state.editingTagId = tag?.id || null;
  $("#tagIdInput").value = tag?.id || "";
  $("#tagNameInput").value = tag?.name || "";
  $("#tagBgInput").value = tag?.backgroundColor || DEFAULT_TAG_COLORS.backgroundColor;
  $("#tagTextInput").value = tag?.textColor || DEFAULT_TAG_COLORS.textColor;
  $("#tagBorderInput").value = tag?.borderColor || DEFAULT_TAG_COLORS.borderColor;
  $("#deleteTagButton").hidden = !tag;
  renderTagManager();
}

function updateTagPreview() {
  const preview = $("#tagPreview");
  const name = $("#tagNameInput").value.trim() || "Tag";
  preview.textContent = name;
  preview.style.backgroundColor = normalizeHexColor($("#tagBgInput").value, DEFAULT_TAG_COLORS.backgroundColor);
  preview.style.color = normalizeHexColor($("#tagTextInput").value, DEFAULT_TAG_COLORS.textColor);
  preview.style.borderColor = normalizeHexColor($("#tagBorderInput").value, DEFAULT_TAG_COLORS.borderColor);
  syncColorSwatches();
}

function randomHex() {
  return `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`;
}

function updateScrollTopButton() {
  scrollTopButton.classList.toggle("visible", content.scrollTop > 0);
}

function isAnyDialogOpen() {
  return [...document.querySelectorAll("dialog")].some((entry) => entry.open);
}

function canDropToMainView() {
  return !isAnyDialogOpen();
}

function filePathFromDrop(file) {
  if (window.itemManager?.getPathForFile) return window.itemManager.getPathForFile(file);
  return file.path || "";
}

function isImagePath(localPath) {
  return /\.(png|jpe?g|webp|gif|svg)$/i.test(String(localPath || "").split(/[?#]/)[0]);
}

function openDialogWithLocalPath(localPath) {
  openDialog();
  $("#pathInput").value = localPath;
  $("#titleInput").value = localPath.split(/[\\/]/).filter(Boolean).pop() || "";
}

function normalizeHexColor(value, fallback) {
  const trimmed = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(trimmed)) return `#${trimmed.toUpperCase()}`;
  return fallback;
}

function hexToRgb(hex) {
  const clean = normalizeHexColor(hex, "#000000").slice(1);
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function rgbToHsv({ r, g, b }) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;

  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return {
    h,
    s: max === 0 ? 0 : delta / max,
    v: max
  };
}

function hsvToRgb({ h, s, v }) {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return {
    r: (r + m) * 255,
    g: (g + m) * 255,
    b: (b + m) * 255
  };
}

function drawColorField() {
  const context = colorField.getContext("2d");
  const width = colorField.width;
  const height = colorField.height;
  const hueColor = rgbToHex(hsvToRgb({ h: activeHsv.h, s: 1, v: 1 }));

  context.clearRect(0, 0, width, height);
  context.fillStyle = hueColor;
  context.fillRect(0, 0, width, height);

  const whiteGradient = context.createLinearGradient(0, 0, width, 0);
  whiteGradient.addColorStop(0, "#fff");
  whiteGradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = whiteGradient;
  context.fillRect(0, 0, width, height);

  const blackGradient = context.createLinearGradient(0, 0, 0, height);
  blackGradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  blackGradient.addColorStop(1, "#000");
  context.fillStyle = blackGradient;
  context.fillRect(0, 0, width, height);

  const markerX = activeHsv.s * width;
  const markerY = (1 - activeHsv.v) * height;
  context.beginPath();
  context.arc(markerX, markerY, 6, 0, Math.PI * 2);
  context.lineWidth = 2;
  context.strokeStyle = "#ffffff";
  context.stroke();
  context.beginPath();
  context.arc(markerX, markerY, 8, 0, Math.PI * 2);
  context.strokeStyle = "rgba(0, 0, 0, 0.75)";
  context.stroke();
}

function setColorFromFieldEvent(event) {
  if (!activeColorInputId) return;
  const rect = colorField.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
  const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));

  activeHsv.s = x / rect.width;
  activeHsv.v = 1 - y / rect.height;
  setColorValue(activeColorInputId, rgbToHex(hsvToRgb(activeHsv)));
  drawColorField();
}

function syncColorSwatches() {
  document.querySelectorAll(".color-swatch-button").forEach((button) => {
    const input = $(`#${button.dataset.colorTarget}`);
    button.style.backgroundColor = normalizeHexColor(input.value, input.defaultValue || DEFAULT_TAG_COLORS.backgroundColor);
  });
  if (activeColorInputId) {
    const input = $(`#${activeColorInputId}`);
    colorPopoverPreview.style.backgroundColor = normalizeHexColor(input.value, input.defaultValue || DEFAULT_TAG_COLORS.backgroundColor);
  }
}

function setColorValue(targetId, value) {
  const input = $(`#${targetId}`);
  input.value = normalizeHexColor(value, input.defaultValue || DEFAULT_TAG_COLORS.backgroundColor);
  syncColorSwatches();
  updateTagPreview();
}

function closeColorPopover() {
  colorPopover.hidden = true;
  activeColorInputId = null;
}

function openColorPopover(targetId, anchor) {
  activeColorInputId = targetId;
  const input = $(`#${targetId}`);
  activeHsv = rgbToHsv(hexToRgb(input.value || input.defaultValue));
  colorHueRange.value = Math.round(activeHsv.h);
  colorPopover.hidden = false;

  const rect = anchor.getBoundingClientRect();
  const dialogRect = tagDialog.getBoundingClientRect();
  const left = rect.left - dialogRect.left;
  const top = rect.bottom - dialogRect.top + 8;
  colorPopover.style.left = `${Math.max(12, Math.min(left, dialogRect.width - colorPopover.offsetWidth - 12))}px`;
  colorPopover.style.top = `${Math.max(12, Math.min(top, dialogRect.height - colorPopover.offsetHeight - 12))}px`;
  drawColorField();
}

async function pickScreenColor(targetId) {
  if (window.itemManager?.pickScreenColor) {
    try {
      const color = await window.itemManager.pickScreenColor();
      setColorValue(targetId, color);
    } catch (error) {
      if (error.message !== "Color picking canceled.") await notify(error.message || "取色失败。");
    }
    return;
  }

  if (!window.EyeDropper) {
    await notify("当前运行环境不支持屏幕取色，请使用颜色输入框选择颜色。");
    return;
  }

  try {
    const result = await new EyeDropper().open();
    setColorValue(targetId, result.sRGBHex);
  } catch (error) {
    if (error.name !== "AbortError") await notify(error.message || "取色失败。");
  }
}

async function chooseLocalPath(kind) {
  return window.itemManager?.pickLocalPath
    ? window.itemManager.pickLocalPath(kind)
    : api("/api/pick-path", {
      method: "POST",
      body: JSON.stringify({ kind })
    });
}

async function pickPath(kind, targetSelector = "#pathInput") {
  try {
    const result = await chooseLocalPath(kind);
    if (result.localPath) {
      const target = $(targetSelector);
      target.value = result.localPath;
      target.dispatchEvent(new Event("input", { bubbles: true }));
    }
  } catch (error) {
    notify(error.message);
  }
}

function updateImportProgress(job) {
  const panel = $("#importProgress");
  const bar = $("#importProgressBar");
  const title = $("#importProgressTitle");
  const count = $("#importProgressCount");
  const text = $("#importProgressText");
  const isRunning = job.status === "queued" || job.status === "running";
  const percent = job.status === "complete"
    ? 100
    : job.discovered
      ? Math.max(5, Math.min(98, Math.round((job.processed / job.discovered) * 100)))
      : 5;

  panel.hidden = false;
  bar.style.width = `${percent}%`;
  bar.classList.toggle("is-active", isRunning);
  title.textContent = job.status === "complete" ? "导入完成" : job.status === "error" ? "导入失败" : "正在导入";
  count.textContent = `${job.created}`;
  text.textContent = job.status === "error"
    ? job.error || "导入失败。"
    : job.status === "complete"
      ? `已创建 ${job.created} 个条目，跳过 ${job.skipped} 个。`
      : `正在导入第一层：已处理 ${job.processed}/${job.discovered}，${job.currentPath || "准备中..."}`;
  $("#importFolderButton").disabled = isRunning;
}

async function pollImportJob(id) {
  try {
    const job = await api(`/api/import-folder/${id}`);
    updateImportProgress(job);
    if (job.status === "complete") {
      $("#importFolderButton").disabled = false;
      await loadData();
      return;
    }
    if (job.status === "error") {
      $("#importFolderButton").disabled = false;
      return;
    }
    importPollTimer = setTimeout(() => pollImportJob(id), 450);
  } catch (error) {
    $("#importFolderButton").disabled = false;
    await notify(error.message);
  }
}

async function importFolder() {
  try {
    const result = await chooseLocalPath("folder");
    if (!result.localPath) return;
    if (importPollTimer) clearTimeout(importPollTimer);
    const job = await api("/api/import-folder", {
      method: "POST",
      body: JSON.stringify({ rootPath: result.localPath })
    });
    updateImportProgress(job);
    importPollTimer = setTimeout(() => pollImportJob(job.id), 250);
  } catch (error) {
    $("#importFolderButton").disabled = false;
    await notify(error.message);
  }
}

async function loadData() {
  const [items, tags, settings] = await Promise.all([
    api("/api/items"),
    api("/api/tags"),
    api("/api/settings").catch(() => loadLocalViewSettings())
  ]);
  state.items = items;
  state.tags = tags;
  applyViewSettings(settings);
  renderAll();
}

$("#newItemButton").addEventListener("click", () => openDialog());
$("#importFolderButton").addEventListener("click", importFolder);
$("#manageTagsButton").addEventListener("click", () => {
  selectTag(state.tags[0] || null);
  tagDialog.showModal();
});
$("#closeDialogButton").addEventListener("click", () => dialog.close());
$("#closeTagDialogButton").addEventListener("click", () => tagDialog.close());
$("#cancelButton").addEventListener("click", () => dialog.close());
$("#searchInput").addEventListener("input", renderItems);
content.addEventListener("scroll", updateScrollTopButton);
scrollTopButton.addEventListener("click", () => {
  content.scrollTo({ top: 0, behavior: "smooth" });
});
$("#coverRatioSelect").addEventListener("change", () => {
  applyViewSettings({ coverRatio: $("#coverRatioSelect").value, cardSize: $("#cardSizeSelect").value });
  saveViewSettings().catch((error) => notify(error.message));
});
$("#cardSizeSelect").addEventListener("change", () => {
  applyViewSettings({ coverRatio: $("#coverRatioSelect").value, cardSize: $("#cardSizeSelect").value });
  saveViewSettings().catch((error) => notify(error.message));
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".select-field")) closeCustomSelects();
});
$("#pickFolderButton").addEventListener("click", () => pickPath("folder"));
$("#pickFileButton").addEventListener("click", () => pickPath("file"));
$("#clearTagFiltersButton").addEventListener("click", () => {
  state.activeTagFilters.clear();
  renderSidebarTags();
  renderItems();
});

$("#messageOkButton").addEventListener("click", (event) => {
  event.preventDefault();
  resolveMessage(true);
});
$("#messageCancelButton").addEventListener("click", () => resolveMessage(false));
$("#messageCloseButton").addEventListener("click", () => resolveMessage(false));
messageDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  resolveMessage(false);
});

$("#coverModeSelect").addEventListener("change", (event) => setCoverMode(event.target.value));
$("#coverUrlInput").addEventListener("input", updateCoverPreview);
$("#coverPathInput").addEventListener("input", updateCoverPreview);
$("#coverPreviewImage").addEventListener("error", () => {
  $("#coverPreviewImage").hidden = true;
  $("#coverPreviewEmpty").hidden = false;
});

$("#tagPicker").addEventListener("change", (event) => {
  const input = event.target.closest("input[type='checkbox']");
  if (!input) return;
  if (input.checked) state.selectedTags.add(input.value);
  else state.selectedTags.delete(input.value);
  renderTagPicker();
});

$("#sidebarTags").addEventListener("change", (event) => {
  const input = event.target.closest("input[type='checkbox']");
  if (!input) return;
  if (input.checked) state.activeTagFilters.add(input.value);
  else state.activeTagFilters.delete(input.value);
  renderSidebarTags();
  renderItems();
});

$("#tagManagerList").addEventListener("click", (event) => {
  const button = event.target.closest(".tag-manager-item");
  if (!button) return;
  selectTag(state.tags.find((tag) => tag.id === button.dataset.id));
});

["tagNameInput", "tagBgInput", "tagTextInput", "tagBorderInput"].forEach((id) => {
  $(`#${id}`).addEventListener("input", updateTagPreview);
});

$("#newTagButton").addEventListener("click", () => selectTag(null));
$("#resetTagColorsButton").addEventListener("click", () => {
  $("#tagBgInput").value = DEFAULT_TAG_COLORS.backgroundColor;
  $("#tagTextInput").value = DEFAULT_TAG_COLORS.textColor;
  $("#tagBorderInput").value = DEFAULT_TAG_COLORS.borderColor;
  updateTagPreview();
});
$("#randomTagColorsButton").addEventListener("click", () => {
  $("#tagBgInput").value = randomHex();
  $("#tagTextInput").value = randomHex();
  $("#tagBorderInput").value = randomHex();
  updateTagPreview();
});

document.querySelectorAll(".eyedropper-button").forEach((button) => {
  button.addEventListener("click", () => pickScreenColor(button.dataset.colorTarget));
});

document.querySelectorAll(".color-swatch-button").forEach((button) => {
  button.addEventListener("click", () => openColorPopover(button.dataset.colorTarget, button));
});

$("#closeColorPopoverButton").addEventListener("click", closeColorPopover);

colorField.addEventListener("pointerdown", (event) => {
  isPickingColorField = true;
  colorField.setPointerCapture(event.pointerId);
  setColorFromFieldEvent(event);
});

colorField.addEventListener("pointermove", (event) => {
  if (isPickingColorField) setColorFromFieldEvent(event);
});

colorField.addEventListener("pointerup", (event) => {
  isPickingColorField = false;
  colorField.releasePointerCapture(event.pointerId);
});

colorHueRange.addEventListener("input", () => {
  if (!activeColorInputId) return;
  activeHsv.h = Number(colorHueRange.value);
  setColorValue(activeColorInputId, rgbToHex(hsvToRgb(activeHsv)));
  drawColorField();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !colorPopover.hidden) closeColorPopover();
});

$("#coverPreview").addEventListener("dragenter", (event) => {
  event.preventDefault();
  event.stopPropagation();
  $("#coverPreview").classList.add("drag-over");
});

$("#coverPreview").addEventListener("dragover", (event) => {
  event.preventDefault();
  event.stopPropagation();
});

$("#coverPreview").addEventListener("dragleave", (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!$("#coverPreview").contains(event.relatedTarget)) {
    $("#coverPreview").classList.remove("drag-over");
  }
});

$("#coverPreview").addEventListener("drop", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  $("#coverPreview").classList.remove("drag-over");

  const files = [...event.dataTransfer.files];
  if (files.length !== 1) {
    await notify("请一次只拖入一张封面图片。");
    return;
  }

  const localPath = filePathFromDrop(files[0]);
  if (!localPath) {
    await notify("无法读取拖入图片的本地路径。");
    return;
  }
  if (!isImagePath(localPath)) {
    await notify("请拖入 png、jpg、webp、gif 或 svg 图片。");
    return;
  }

  $("#coverPathInput").value = localPath;
  setCoverMode("local");
});

window.addEventListener("dragenter", (event) => {
  event.preventDefault();
  if (!canDropToMainView()) {
    dragDepth = 0;
    content.classList.remove("drag-over");
    return;
  }
  dragDepth += 1;
  content.classList.add("drag-over");
});

window.addEventListener("dragover", (event) => {
  event.preventDefault();
});

window.addEventListener("dragleave", (event) => {
  event.preventDefault();
  if (!canDropToMainView()) {
    dragDepth = 0;
    content.classList.remove("drag-over");
    return;
  }
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) content.classList.remove("drag-over");
});

window.addEventListener("drop", async (event) => {
  event.preventDefault();
  dragDepth = 0;
  content.classList.remove("drag-over");
  if (!canDropToMainView()) return;

  const files = [...event.dataTransfer.files];
  if (files.length !== 1) {
    await notify("请一次只拖入一个文件或文件夹。");
    return;
  }

  const localPath = filePathFromDrop(files[0]);
  if (!localPath) {
    await notify("无法读取拖入项目的本地路径。");
    return;
  }

  openDialogWithLocalPath(localPath);
});

tagForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    name: $("#tagNameInput").value,
    backgroundColor: normalizeHexColor($("#tagBgInput").value, DEFAULT_TAG_COLORS.backgroundColor),
    textColor: normalizeHexColor($("#tagTextInput").value, DEFAULT_TAG_COLORS.textColor),
    borderColor: normalizeHexColor($("#tagBorderInput").value, DEFAULT_TAG_COLORS.borderColor)
  };
  if (!payload.name.trim()) {
    await notify("请填写标签名称。");
    return;
  }
  try {
    if (state.editingTagId) {
      await api(`/api/tags/${state.editingTagId}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await api("/api/tags", { method: "POST", body: JSON.stringify(payload) });
    }
    await loadData();
    const saved = state.tags.find((tag) => tag.name === payload.name.trim());
    selectTag(saved || state.tags[0] || null);
  } catch (error) {
    await notify(error.message === "Tag already exists." ? "标签已存在。" : error.message);
  }
});

$("#deleteTagButton").addEventListener("click", async () => {
  if (!state.editingTagId) return;
  if (!await ask("删除该标签？已使用它的条目会同时移除此标签。")) return;
  await api(`/api/tags/${state.editingTagId}`, { method: "DELETE" });
  state.selectedTags.delete($("#tagNameInput").value);
  await loadData();
  selectTag(state.tags[0] || null);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = readForm();

  if (hasDuplicateTitle(payload.title, state.editingId)) {
    await notify("标题已存在，不能保存重复标题。");
    return;
  }

  try {
    if (state.editingId) {
      await api(`/api/items/${state.editingId}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await api("/api/items", { method: "POST", body: JSON.stringify(payload) });
    }
  } catch (error) {
    await notify(error.message === "Title already exists." ? "标题已存在，不能保存重复标题。" : error.message);
    return;
  }

  dialog.close();
  await loadData();
});

$("#deleteButton").addEventListener("click", async () => {
  if (!state.editingId || !await ask("删除这个条目？")) return;
  await api(`/api/items/${state.editingId}`, { method: "DELETE" });
  dialog.close();
  await loadData();
});

grid.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  const card = event.target.closest(".card");
  if (!card) return;
  const item = state.items.find((entry) => entry.id === card.dataset.id);
  if (!item) return;

  if (!button) {
    openDialog(item);
    return;
  }

  if (button.dataset.action === "open") {
    if (!item.url) {
      await notify("该条目未设置网页链接。");
      return;
    }
    try {
      await api("/api/open-url", { method: "POST", body: JSON.stringify({ url: item.url }) });
    } catch (error) {
      await notify(error.message);
    }
    return;
  }

  if (button.dataset.action === "reveal") {
    if (!item.localPath) {
      await notify("该条目未设置本地路径。");
      return;
    }
    try {
      await api("/api/reveal-path", { method: "POST", body: JSON.stringify({ localPath: item.localPath }) });
    } catch (error) {
      await notify(error.message === "Path does not exist." ? "本地路径无效或不存在。" : error.message);
    }
  }
});

initCustomSelects();
applyViewSettings(loadLocalViewSettings());
updateScrollTopButton();
loadData().catch((error) => {
  emptyState.classList.add("visible");
  emptyState.innerHTML = `<h3>加载失败</h3><p>${escapeHtml(error.message)}</p>`;
});
