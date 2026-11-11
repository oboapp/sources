import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(import.meta.url);
const tsx = require.resolve("tsx/cli");

// Run Node directly so package-manager executables cannot drop V8 coverage.
for (const entry of await readdir(join(root, "packages"), { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  const directory = join(root, "packages", entry.name);
  const tests = (await readdir(join(directory, "test")))
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => join("test", name));
  if (tests.length === 0) {
    throw new Error(`No source contracts found for ${entry.name}`);
  }
  const result = spawnSync(process.execPath, [tsx, "--test", ...tests], {
    cwd: directory,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
