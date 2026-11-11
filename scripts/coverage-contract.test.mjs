import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { validateLcov } from "./check-coverage.mjs";

test("maps ESM coverage to TypeScript, includes untested files and excludes CommonJS counters", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const require = createRequire(import.meta.url);
  const temporaryRoot = resolve(tmpdir());
  const fixture = await mkdtemp(join(temporaryRoot, "obo-coverage-"));
  if (dirname(resolve(fixture)) !== temporaryRoot) {
    throw new Error("Unsafe fixture cleanup path");
  }
  try {
    const packageDirectory = join(fixture, "packages", "source-fixture");
    const sourceDirectory = join(packageDirectory, "src");
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(join(packageDirectory, "package.json"), '{"type":"module"}\n');
    await writeFile(join(sourceDirectory, "runtime.ts"), [
      "export function coveredByEsm() {",
      "  return 1;",
      "}",
      "export function cjsOnly() {",
      "  return 2;",
      "}",
      "",
    ].join("\n"));
    await writeFile(join(sourceDirectory, "untested.ts"), [
      "export function untested() {",
      "  return 3;",
      "}",
      "",
    ].join("\n"));
    await writeFile(join(fixture, ".c8rc.json"), await readFile(join(root, ".c8rc.json")));
    for (const [format, module] of [["esm", "ES2022"], ["cjs", "CommonJS"]]) {
      execFileSync(process.execPath, [
        require.resolve("typescript/bin/tsc"),
        join(sourceDirectory, "runtime.ts"),
        join(sourceDirectory, "untested.ts"),
        "--target", "ES2022",
        "--module", module,
        "--inlineSourceMap", "--inlineSources",
        "--outDir", join(packageDirectory, "dist", format),
      ], { cwd: fixture, stdio: "pipe" });
    }
    await writeFile(join(packageDirectory, "dist", "cjs", "package.json"), '{"type":"commonjs"}\n');
    await writeFile(join(fixture, "run.mjs"), [
      "import { coveredByEsm } from './packages/source-fixture/dist/esm/runtime.js';",
      "import { createRequire } from 'node:module';",
      "const require = createRequire(import.meta.url);",
      "coveredByEsm();",
      "require('./packages/source-fixture/dist/cjs/runtime.js').cjsOnly();",
      "",
    ].join("\n"));
    execFileSync(process.execPath, [
      require.resolve("c8/bin/c8.js"),
      "--reporter=lcovonly", process.execPath, "run.mjs",
    ], { cwd: fixture, stdio: "pipe" });
    const report = await readFile(join(fixture, "coverage", "lcov.info"), "utf8");
    const files = new Map([
      ["packages/source-fixture/src/runtime.ts", 7],
      ["packages/source-fixture/src/untested.ts", 4],
    ]);
    assert.equal(validateLcov(report, files), 2);
    const records = report.replaceAll("\\", "/").split("end_of_record");
    const runtime = records.find((record) => record.includes("SF:packages/source-fixture/src/runtime.ts"));
    const untested = records.find((record) => record.includes("SF:packages/source-fixture/src/untested.ts"));
    assert.match(runtime, /FNDA:[1-9][0-9]*,coveredByEsm/);
    assert.match(runtime, /FNDA:0,cjsOnly/);
    assert.equal(runtime.match(/FN:[0-9]+,coveredByEsm/g).length, 1);
    assert.doesNotMatch(untested, /DA:[0-9]+,[1-9]/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
