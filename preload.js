const { contextBridge, webUtils } = require("electron");

contextBridge.exposeInMainWorld("itemManager", {
  getPathForFile(file) {
    return webUtils.getPathForFile(file);
  }
});
