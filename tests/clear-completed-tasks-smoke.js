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
          expression: `(async () => {
            updateImportProgress({
              id: "clear-import",
              status: "complete",
              discovered: 2,
              processed: 2,
              created: 2,
              skipped: 0,
              currentPath: ""
            });

            const complete = async (jobId, extra = {}) => {
              await handleItemImportEvent({ type: "started", jobId, fileName: jobId + ".zip" });
              await handleItemImportEvent({ type: "completed", jobId, ...extra });
            };
            await complete("clear-success");
            await complete("clear-skipped", { warning: "已存在相同条目，跳过创建" });
            await complete("keep-completion-error", {
              warning: "文件已下载，但自动创建条目失败：测试错误",
              completionHasError: true
            });
            await handleItemImportEvent({
              type: "started",
              jobId: "keep-error",
              fileName: "keep-error.zip"
            });
            await handleItemImportEvent({
              type: "error",
              jobId: "keep-error",
              message: "下载失败"
            });
            await handleItemImportEvent({
              type: "started",
              jobId: "keep-cancelled",
              fileName: "keep-cancelled.zip"
            });
            await handleItemImportEvent({ type: "cancelled", jobId: "keep-cancelled" });

            const before = {
              buttonEnabled: !document.querySelector("#clearCompletedTasksButton").disabled,
              importVisible: !document.querySelector("#importProgress").hidden
            };
            document.querySelector("#clearCompletedTasksButton").click();
            const exists = (jobId) => state.downloadJobs.has(jobId);
            return {
              before,
              importHidden: document.querySelector("#importProgress").hidden,
              successExists: exists("clear-success"),
              skippedExists: exists("clear-skipped"),
              completionErrorExists: exists("keep-completion-error"),
              errorExists: exists("keep-error"),
              cancelledExists: exists("keep-cancelled"),
              buttonDisabled: document.querySelector("#clearCompletedTasksButton").disabled
            };
          })()`,
          awaitPromise: true,
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

  const passed = result?.before?.buttonEnabled &&
    result.before.importVisible &&
    result.importHidden &&
    !result.successExists &&
    !result.skippedExists &&
    result.completionErrorExists &&
    result.errorExists &&
    result.cancelledExists &&
    result.buttonDisabled;
  console.log(JSON.stringify({ ...result, passed }));
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
