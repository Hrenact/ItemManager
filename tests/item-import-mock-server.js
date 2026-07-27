const http = require("http");

const PORT = Number(process.env.ITEM_IMPORT_MOCK_PORT || 4200);
const CHUNK = Buffer.alloc(64 * 1024, 0x5a);

function sendFile(res, { chunks, interval }) {
  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Length": CHUNK.length * chunks
  });

  let sent = 0;
  const timer = setInterval(() => {
    if (sent >= chunks) {
      clearInterval(timer);
      res.end();
      return;
    }
    res.write(CHUNK);
    sent += 1;
  }, interval);
  res.on("close", () => clearInterval(timer));
}

http.createServer((req, res) => {
  if (req.url === "/slow.zip") {
    sendFile(res, { chunks: 10000, interval: 50 });
    return;
  }
  if (req.url === "/fast.zip") {
    sendFile(res, { chunks: 4, interval: 5 });
    return;
  }
  if (req.url === "/terminated.zip") {
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": CHUNK.length * 20
    });
    res.write(CHUNK);
    setTimeout(() => res.destroy(), 60);
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Item import mock server listening on ${PORT}`);
});
