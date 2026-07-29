async function connect() {
  const pages = await fetch("http://127.0.0.1:9223/json/list").then((response) => response.json());
  const page = pages.find((entry) => entry.type === "page");
  if (!page?.webSocketDebuggerUrl) throw new Error("Electron debug page was not found.");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP connection failed.")), { once: true });
  });
  return socket;
}

async function evaluate(socket, id, expression) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("CDP evaluation timed out.")), 5000);
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.text || "CDP evaluation failed."));
        return;
      }
      resolve(message.result?.result?.value || null);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: {
        expression,
        awaitPromise: true,
        returnByValue: true
      }
    }));
  });
}

async function main() {
  const socket = await connect();
  try {
    const states = await evaluate(socket, 1, `(async () => {
      updateImportProgress({
        id: "task-import-smoke",
        status: "running",
        discovered: 4,
        processed: 2,
        created: 2,
        skipped: 0,
        currentPath: "C:/Smoke/item.zip"
      });
      await handleItemImportEvent({
        type: "started",
        jobId: "task-download-smoke",
        fileName: "task-download-smoke.zip"
      });
      const running = {
        importVisible: !document.querySelector("#importProgress").hidden,
        importDismissHidden: document.querySelector("#dismissImportProgressButton").hidden,
        downloadCancelVisible: Boolean(document.querySelector("[data-action='cancel-download']"))
      };

      updateImportProgress({
        id: "task-import-smoke",
        status: "complete",
        discovered: 4,
        processed: 4,
        created: 4,
        skipped: 0,
        currentPath: ""
      });
      await handleItemImportEvent({
        type: "completed",
        jobId: "task-download-smoke",
        fileName: "task-download-smoke.zip",
        receivedBytes: 1024,
        totalBytes: 1024
      });
      const completed = {
        importDismissVisible: !document.querySelector("#dismissImportProgressButton").hidden,
        downloadDismissVisible: Boolean(document.querySelector("[data-action='dismiss-download']")),
        downloadStatus: document.querySelector(".download-job-status")?.textContent || ""
      };
      return { running, completed };
    })()`);

    await new Promise((resolve) => setTimeout(resolve, 11000));
    const retained = await evaluate(socket, 2, `({
      importVisible: !document.querySelector("#importProgress").hidden,
      targetDownloadPresent: Boolean(document.querySelector('.download-job[data-job-id="task-download-smoke"]')),
      importDismissVisible: !document.querySelector("#dismissImportProgressButton").hidden,
      downloadDismissVisible: Boolean(document.querySelector('.download-job[data-job-id="task-download-smoke"] [data-action="dismiss-download"]'))
    })`);

    const dismissed = await evaluate(socket, 3, `(() => {
      document.querySelector("#dismissImportProgressButton").click();
      document.querySelector('.download-job[data-job-id="task-download-smoke"] [data-action="dismiss-download"]').click();
      return {
        importHidden: document.querySelector("#importProgress").hidden,
        targetDownloadPresent: Boolean(document.querySelector('.download-job[data-job-id="task-download-smoke"]'))
      };
    })()`);

    const passed = states?.running?.importVisible &&
      states.running.importDismissHidden &&
      states.running.downloadCancelVisible &&
      states.completed.importDismissVisible &&
      states.completed.downloadDismissVisible &&
      states.completed.downloadStatus === "下载完成" &&
      retained?.importVisible &&
      retained.targetDownloadPresent &&
      retained.importDismissVisible &&
      retained.downloadDismissVisible &&
      dismissed?.importHidden &&
      !dismissed.targetDownloadPresent;

    console.log(JSON.stringify({ states, retained, dismissed, passed }));
    if (!passed) process.exitCode = 1;
  } finally {
    socket.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
