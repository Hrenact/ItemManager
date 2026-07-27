async function main() {
  const [page] = await fetch("http://127.0.0.1:9224/json/list").then((response) => response.json());
  if (!page?.webSocketDebuggerUrl) throw new Error("Packaged Electron debug page was not found.");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    handler(message.result?.result?.value);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP connection failed.")), { once: true });
  });

  function evaluate(expression, awaitPromise = false) {
    return new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      socket.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise }
      }));
    });
  }

  const prompt = await evaluate(`({
    messageOpen: document.querySelector("#messageDialog")?.open || false,
    message: document.querySelector("#messageBody")?.textContent || ""
  })`);
  const afterConfirm = await evaluate(`(async () => {
    document.querySelector("#messageOkButton")?.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { settingsOpen: document.querySelector("#settingsDialog")?.open || false };
  })()`, true);
  socket.close();

  const passed = prompt?.messageOpen &&
    prompt.message.includes("请先在设置中选择文件下载保存目录") &&
    afterConfirm?.settingsOpen;
  console.log(JSON.stringify({ ...prompt, ...afterConfirm, passed }));
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
