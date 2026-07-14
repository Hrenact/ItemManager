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

const $ = (selector) => document.querySelector(selector);

const grid = $("#itemsGrid");
const dialog = $("#itemDialog");
const form = $("#itemForm");
const tagDialog = $("#tagDialog");
const tagForm = $("#tagForm");
const messageDialog = $("#messageDialog");
const emptyState = $("#emptyState");

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
  return `<img class="cover" src="${escapeHtml(source)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'), { className: 'cover cover-placeholder', textContent: '?' }))" />`;
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
    <article class="card" data-id="${item.id}">
      ${coverFor(item)}
      <div class="card-body">
        <h3>${escapeHtml(item.title)}</h3>
        <p class="meta">${escapeHtml(item.creator || "未设置作者")}</p>
        <div class="tags">
          ${(item.tags || []).slice(0, 5).map((tag) => `<span class="tag" style="${tagStyle(tag)}">${escapeHtml(tag)}</span>`).join("")}
        </div>
        <div class="card-actions">
          <button data-action="open">网页</button>
          <button data-action="reveal">路径</button>
          <button data-action="edit">编辑</button>
        </div>
      </div>
    </article>
  `).join("");
}

function renderSidebarTags() {
  const sidebarTags = $("#sidebarTags");
  sidebarTags.innerHTML = state.tags.length
    ? state.tags.map((tag) => `
      <label class="filter-tag ${state.activeTagFilters.has(tag.name) ? "active" : ""}" style="${tagStyle(tag.name)}">
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
      <label class="tag-choice" style="${tagStyle(tag.name)}">
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
      <button type="button" class="tag-manager-item ${tag.id === state.editingTagId ? "active" : ""}" data-id="${tag.id}">
        <span class="tag" style="${tagStyle(tag.name)}">${escapeHtml(tag.name)}</span>
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
  document.querySelector(`input[name="coverMode"][value="${mode}"]`).checked = true;
  $("#coverUrlGroup").hidden = mode !== "url";
  $("#coverPathGroup").hidden = mode !== "local";
  $("#copyCoverButton").hidden = mode !== "local";
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
  preview.style.backgroundColor = $("#tagBgInput").value;
  preview.style.color = $("#tagTextInput").value;
  preview.style.borderColor = $("#tagBorderInput").value;
}

function randomHex() {
  return `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`;
}

async function pickPath(kind) {
  try {
    const result = await api("/api/pick-path", {
      method: "POST",
      body: JSON.stringify({ kind })
    });
    if (result.localPath) $("#pathInput").value = result.localPath;
  } catch (error) {
    notify(error.message);
  }
}

async function loadData() {
  const [items, tags] = await Promise.all([
    api("/api/items"),
    api("/api/tags")
  ]);
  state.items = items;
  state.tags = tags;
  renderAll();
}

$("#newItemButton").addEventListener("click", () => openDialog());
$("#manageTagsButton").addEventListener("click", () => {
  selectTag(state.tags[0] || null);
  tagDialog.showModal();
});
$("#closeDialogButton").addEventListener("click", () => dialog.close());
$("#closeTagDialogButton").addEventListener("click", () => tagDialog.close());
$("#cancelButton").addEventListener("click", () => dialog.close());
$("#searchInput").addEventListener("input", renderItems);
$("#coverRatioSelect").addEventListener("change", () => {
  document.documentElement.style.setProperty("--cover-ratio", $("#coverRatioSelect").value);
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

document.querySelectorAll('input[name="coverMode"]').forEach((input) => {
  input.addEventListener("change", () => setCoverMode(input.value));
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

tagForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    name: $("#tagNameInput").value,
    backgroundColor: $("#tagBgInput").value,
    textColor: $("#tagTextInput").value,
    borderColor: $("#tagBorderInput").value
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

$("#copyCoverButton").addEventListener("click", async () => {
  const source = $("#coverPathInput").value.trim();
  if (!source) {
    await notify("请先填写本地图片路径。");
    return;
  }
  try {
    const result = await api("/api/copy-cover", {
      method: "POST",
      body: JSON.stringify({ coverPath: source })
    });
    $("#coverPathInput").value = result.coverPath;
  } catch (error) {
    await notify(error.message);
  }
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
  if (!button || !card) return;
  const item = state.items.find((entry) => entry.id === card.dataset.id);
  if (!item) return;

  if (button.dataset.action === "edit") {
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

loadData().catch((error) => {
  emptyState.classList.add("visible");
  emptyState.innerHTML = `<h3>加载失败</h3><p>${escapeHtml(error.message)}</p>`;
});
