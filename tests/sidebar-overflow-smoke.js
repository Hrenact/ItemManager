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
            state.tags = Array.from({ length: 80 }, (_, index) => ({
              id: "overflow-tag-" + index,
              name: "测试标签 " + (index + 1),
              backgroundColor: "#202633",
              textColor: "#bfd0df",
              borderColor: "#2a3140"
            }));
            renderSidebarTags();

            for (let index = 0; index < 30; index += 1) {
              const jobId = "overflow-job-" + index;
              state.downloadJobs.set(jobId, {
                jobId,
                fileName: "测试下载任务-" + (index + 1) + ".zip",
                status: "completed",
                statusMessage: "下载完成",
                receivedBytes: 1024,
                totalBytes: 1024
              });
            }
            renderDownloadJobs();

            const sidebar = document.querySelector(".sidebar");
            const frame = document.querySelector(".sidebar-workspace-frame");
            const workspace = document.querySelector(".sidebar-workspace");
            const footer = document.querySelector(".sidebar-footer");
            const sidebarRect = sidebar.getBoundingClientRect();
            const frameRect = frame.getBoundingClientRect();
            const workspaceRect = workspace.getBoundingClientRect();
            const footerRect = footer.getBoundingClientRect();
            const frameStyle = getComputedStyle(frame);
            const workspaceStyle = getComputedStyle(workspace);
            const sidebarStyle = getComputedStyle(sidebar);
            const optionValues = [...document.querySelector("#cardSizeSelect").options].map((option) => option.value);

            workspace.scrollTop = 0;
            updateSidebarScrollShadows();
            const shadowsAtTop = {
              up: frame.classList.contains("can-scroll-up"),
              down: frame.classList.contains("can-scroll-down")
            };
            workspace.scrollTop = workspace.scrollHeight;
            updateSidebarScrollShadows();
            const shadowsAtBottom = {
              up: frame.classList.contains("can-scroll-up"),
              down: frame.classList.contains("can-scroll-down")
            };

            applyViewSettings({ coverRatio: "1 / 1", cardSize: "220px" });
            const migratedCompact = getComputedStyle(document.documentElement).getPropertyValue("--card-min").trim();
            applyViewSettings({ coverRatio: "1 / 1", cardSize: "230px" });
            const standard = getComputedStyle(document.documentElement).getPropertyValue("--card-min").trim();
            applyViewSettings({ coverRatio: "1 / 1", cardSize: "300px" });
            const relaxed = getComputedStyle(document.documentElement).getPropertyValue("--card-min").trim();

            return {
              sidebarOverflowY: sidebarStyle.overflowY,
              sidebarFits: sidebar.scrollHeight === sidebar.clientHeight,
              workspaceScrollable: workspace.scrollHeight > workspace.clientHeight,
              workspaceScrollbarWidth: workspaceStyle.scrollbarWidth,
              frameTopBorder: frameStyle.borderTopStyle,
              frameBottomBorder: frameStyle.borderBottomStyle,
              scrollAreaInsideBorders:
                workspaceRect.top > frameRect.top &&
                workspaceRect.bottom < frameRect.bottom,
              shadowsAtTop,
              shadowsAtBottom,
              footerVisible: footerRect.top >= sidebarRect.top && footerRect.bottom <= sidebarRect.bottom,
              optionValues,
              migratedCompact,
              standard,
              relaxed
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

  const passed = result?.sidebarOverflowY === "hidden" &&
    result.sidebarFits &&
    result.workspaceScrollable &&
    result.workspaceScrollbarWidth === "none" &&
    result.frameTopBorder === "solid" &&
    result.frameBottomBorder === "solid" &&
    result.scrollAreaInsideBorders &&
    !result.shadowsAtTop.up &&
    result.shadowsAtTop.down &&
    result.shadowsAtBottom.up &&
    !result.shadowsAtBottom.down &&
    result.footerVisible &&
    JSON.stringify(result.optionValues) === JSON.stringify(["170px", "230px", "300px"]) &&
    result.migratedCompact === "170px" &&
    result.standard === "230px" &&
    result.relaxed === "300px";
  console.log(JSON.stringify({ ...result, passed }));
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
