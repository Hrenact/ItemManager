async function main() {
  const [page] = await fetch("http://127.0.0.1:9223/json/list").then((response) => response.json());
  if (!page?.webSocketDebuggerUrl) throw new Error("Electron debug page was not found.");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("CDP evaluation timed out.")), 5000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression: `(() => {
            state.tags = [];
            state.downloadJobs.clear();
            activeImportJob = null;
            document.querySelector("#importProgress").hidden = true;
            renderSidebarTags();
            renderDownloadJobs();
            const empty = {
              tagText: document.querySelector("#sidebarTags").textContent.trim(),
              taskText: document.querySelector("#taskEmptyState").textContent.trim(),
              taskVisible: !document.querySelector("#taskEmptyState").hidden
            };

            state.tags = [{
              id: "placeholder-tag",
              name: "测试标签",
              backgroundColor: "#202633",
              textColor: "#bfd0df",
              borderColor: "#2a3140"
            }];
            renderSidebarTags();
            state.downloadJobs.set("placeholder-task", {
              jobId: "placeholder-task",
              fileName: "placeholder-task.zip",
              status: "started",
              receivedBytes: 0,
              totalBytes: 0
            });
            renderDownloadJobs();
            const populated = {
              tagPlaceholderGone: !document.querySelector("#sidebarTags").textContent.includes("暂无标签"),
              taskHidden: document.querySelector("#taskEmptyState").hidden
            };

            return {
              manageText: document.querySelector("#manageTagsButton").textContent.trim(),
              clearText: document.querySelector("#clearCompletedTasksButton").textContent.trim(),
              empty,
              populated
            };
          })()`,
          returnByValue: true
        }
      }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      resolve(message.result?.result?.value || null);
      socket.close();
    });
    socket.addEventListener("error", () => reject(new Error("CDP connection failed.")));
  });

  const passed = result?.manageText === "管理" &&
    result.clearText === "清空" &&
    result.empty?.tagText === "暂无标签" &&
    result.empty.taskText === "暂无任务" &&
    result.empty.taskVisible &&
    result.populated?.tagPlaceholderGone &&
    result.populated.taskHidden;
  console.log(JSON.stringify({ ...result, passed }));
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
