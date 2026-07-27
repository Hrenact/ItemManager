const { spawn } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mode = process.argv[2] || "slow";
const packaged = mode === "packaged-no-root";
const electron = packaged
  ? path.join(root, "release", "win-unpacked", "Item Manager.exe")
  : path.join(root, "node_modules", "electron", "dist", "electron.exe");
const downloadMode = ["fast", "terminated"].includes(mode) ? mode : "slow";
const protocolUrl = new URL("booth-library-manager://item-import");
protocolUrl.searchParams.set(
  "dlurl",
  packaged ? "https://s6.booth.pm/smoke-test.zip" : `http://127.0.0.1:4200/${downloadMode}.zip`
);
protocolUrl.searchParams.set(
  "downloadable_filename",
  mode === "long" ? `${"very-long-booth-file-name-".repeat(12)}asset.zip` : "asset.zip"
);
protocolUrl.searchParams.set("item_id", "7903171");
protocolUrl.searchParams.set("order_id", "83503943");
protocolUrl.searchParams.set("variation_id", "13233303");

const args = [`--remote-debugging-port=${packaged ? 9224 : 9223}`];
if (!packaged) args.push(root);
args.push(protocolUrl.href);

const child = spawn(electron, args, {
  cwd: root,
  detached: true,
  stdio: "ignore",
  windowsHide: true,
  env: packaged ? process.env : {
    ...process.env,
    NODE_ENV: "test",
    ITEM_MANAGER_TEST_DOWNLOAD_ORIGIN: "http://127.0.0.1:4200",
    ITEM_MANAGER_DATA_DIR: path.join(root, ".smoke-item-import", "data")
  }
});
child.unref();
console.log(child.pid);
