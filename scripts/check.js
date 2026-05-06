const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const files = [
  path.join(ROOT, "app.js"),
  path.join(ROOT, "server.js"),
  ...walk(path.join(ROOT, "scripts")),
  ...walk(path.join(ROOT, "modules")),
];

let failed = 0;

for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const isRootEsm = rel === "app.js";
  const args = isRootEsm ? ["--check", "--input-type=module"] : ["--check", file];
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    input: isRootEsm ? fs.readFileSync(file, "utf8") : undefined,
  });

  if (result.status === 0) {
    console.log(`${rel} OK`);
  } else {
    failed++;
    console.error(`FAIL ${rel}`);
    const output = `${result.stderr || ""}${result.stdout || ""}`.trim();
    if (output) console.error(output);
  }
}

process.exitCode = failed ? 1 : 0;
