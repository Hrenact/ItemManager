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
            const gradient = getComputedStyle(document.querySelector("#colorHueRange")).backgroundImage;
            const expected = [
              "rgb(255, 0, 0)",
              "rgb(255, 255, 0)",
              "rgb(0, 255, 0)",
              "rgb(0, 255, 255)",
              "rgb(0, 0, 255)",
              "rgb(255, 0, 255)"
            ];
            const positions = expected.map((color) => gradient.indexOf(color));
            const hue60 = hsvToRgb({ h: 60, s: 1, v: 1 });
            const hue240 = hsvToRgb({ h: 240, s: 1, v: 1 });
            return {
              gradient,
              positions,
              ordered: positions.every((position, index) =>
                position >= 0 && (index === 0 || position > positions[index - 1])),
              hue60: rgbToHex(hue60),
              hue240: rgbToHex(hue240)
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

  const passed = result?.ordered &&
    result.hue60 === "#FFFF00" &&
    result.hue240 === "#0000FF";
  console.log(JSON.stringify({ ...result, passed }));
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
