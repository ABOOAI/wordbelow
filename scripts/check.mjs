// Portable local verification. Requires Node.js 18 or newer; no dependencies.
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = readdirSync(join(root, "extension"))
  .filter(name => name.endsWith(".js"))
  .sort();

function run(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error(`${label}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

for (const script of scripts) run(["--check", join(root, "extension", script)], `Syntax: ${script}`);
console.log(`JavaScript syntax passed: ${scripts.length} extension files.`);
run([join(root, "tests", "test-options.cjs")], "Settings regression");

