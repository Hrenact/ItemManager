const fs = require("fs/promises");
const path = require("path");

const UNUSED_RUNTIME_FILES = [
  "d3dcompiler_47.dll",
  "dxcompiler.dll",
  "dxil.dll",
  "vk_swiftshader.dll",
  "vk_swiftshader_icd.json",
  "vulkan-1.dll"
];

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  await Promise.all(
    UNUSED_RUNTIME_FILES.map((fileName) =>
      fs.rm(path.join(context.appOutDir, fileName), { force: true })
    )
  );
};
