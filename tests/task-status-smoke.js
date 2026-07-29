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
            const complete = async (jobId, warning = "") => {
              await handleItemImportEvent({ type: "started", jobId, fileName: jobId + ".zip" });
              await handleItemImportEvent({ type: "completed", jobId, warning });
            };
            await complete("plain-status");
            await complete("duplicate-status", "已存在相同条目，跳过创建");
            await complete(
              "long-status",
              "这是用于验证任务状态过长时会在鼠标悬停后自动缓慢横向滚动的很长提示文本"
            );
            await handleItemImportEvent({
              type: "started",
              jobId: "error-status",
              fileName: "error-status.zip"
            });
            await handleItemImportEvent({
              type: "error",
              jobId: "error-status",
              message: "下载连接意外中断，请重试。"
            });
            const statusFor = (jobId) =>
              document.querySelector(\`.download-job[data-job-id="\${jobId}"] .download-job-status\`);
            const plainStatus = statusFor("plain-status");
            const duplicateStatus = statusFor("duplicate-status");
            const longStatus = statusFor("long-status");
            const errorStatus = statusFor("error-status");
            return {
              messageOpen: document.querySelector("#messageDialog")?.open || false,
              plainText: plainStatus?.textContent || "",
              duplicateText: duplicateStatus?.textContent || "",
              longText: longStatus?.textContent || "",
              errorText: errorStatus?.textContent || "",
              longOverflowing: longStatus?.classList.contains("is-overflowing") || false,
              longScrollDistance: longStatus?.style.getPropertyValue("--status-scroll-distance") || "",
              longScrollDuration: longStatus?.style.getPropertyValue("--status-scroll-duration") || ""
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

  const passed = !result?.messageOpen &&
    result?.plainText === "下载完成" &&
    result.duplicateText === "下载完成，存在相同条目跳过创建" &&
    result.errorText === "下载连接意外中断，请重试。" &&
    result.longOverflowing &&
    result.longScrollDistance.endsWith("px") &&
    result.longScrollDistance !== "0px" &&
    result.longScrollDuration.endsWith("s");
  console.log(JSON.stringify({ ...result, passed }));
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
