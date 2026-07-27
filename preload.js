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
