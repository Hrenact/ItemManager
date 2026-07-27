const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("itemManager", {
  getPathForFile(file) {
    return webUtils.getPathForFile(file);
  },
  pickLocalPath(kind) {
    return ipcRenderer.invoke("pick-local-path", kind);
  },
  applyDesktopSettings(settings) {
    return ipcRenderer.invoke("apply-desktop-settings", settings);
  },
  onItemImportEvent(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("item-import-event", listener);
    return () => ipcRenderer.removeListener("item-import-event", listener);
  },
  readyForItemImports() {
    ipcRenderer.send("item-import-renderer-ready");
  },
  cancelItemDownload(jobId) {
    return ipcRenderer.invoke("cancel-item-download", jobId);
  },
  pickScreenColor() {
    return ipcRenderer.invoke("pick-screen-color");
  },
  finishScreenColorPick(point) {
    return ipcRenderer.send("finish-screen-color-pick", point);
  },
  cancelScreenColorPick() {
    return ipcRenderer.send("cancel-screen-color-pick");
  }
});
