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
            const name = document.querySelector(".download-job-name");
            const jobs = document.querySelector("#downloadJobs");
            const style = name ? getComputedStyle(name) : null;
            return {
              isTruncated: Boolean(name && name.scrollWidth > name.clientWidth),
              textOverflow: style?.textOverflow || "",
              overflow: style?.overflow || "",
              hasHorizontalOverflow: Boolean(jobs && jobs.scrollWidth > jobs.clientWidth)
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
  const passed = result?.isTruncated &&
    result.textOverflow === "ellipsis" &&
    result.overflow === "hidden" &&
    !result.hasHorizontalOverflow;
  console.log(JSON.stringify({ ...result, passed }));
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
