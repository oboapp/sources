import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { log } from "node:console";

/** Reject generated paths, duplicate records and omitted source files before upload. */
export function validateLcov(report, sourceFiles) {
  const coveredFiles = new Set();
  let hasCollectedHits = false;
  for (const record of report.split("end_of_record")) {
    const sourceLine = record.split(/\r?\n/).find((line) => line.startsWith("SF:"));
    if (!sourceLine) {
      continue;
    }
    const path = sourceLine.slice(3).replaceAll("\\", "/");
    if (!sourceFiles.has(path)) {
      throw new Error(`Coverage contains a non-source or non-relative path: ${path}`);
    }
    if (coveredFiles.has(path)) {
      throw new Error(`Coverage contains duplicate records for ${path}`);
    }
    coveredFiles.add(path);
    const recordedLines = new Set();
    for (const line of record.split(/\r?\n/)) {
      if (!line.startsWith("DA:")) {
        continue;
      }
      const [lineNumber, hits] = line.slice(3).split(",").map(Number);
      if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > sourceFiles.get(path)) {
        throw new Error(`Coverage line is outside ${path}: ${line}`);
      }
      if (!Number.isInteger(hits) || hits < 0 || recordedLines.has(lineNumber)) {
        throw new Error(`Coverage has invalid or duplicate line data for ${path}: ${line}`);
      }
      recordedLines.add(lineNumber);
      hasCollectedHits ||= hits > 0;
    }
  }
  const missing = [...sourceFiles.keys()].filter((path) => !coveredFiles.has(path));
  if (missing.length > 0) {
    throw new Error(`Coverage is missing production source files:\n${missing.join("\n")}`);
  }
  if (!hasCollectedHits) {
    throw new Error("Coverage has no collected source hits; verify V8 coverage is enabled");
  }
  return coveredFiles.size;
}

async function readSourceFiles(directory, root, sourceFiles) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await readSourceFiles(path, root, sourceFiles);
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      const source = await readFile(path, "utf8");
      sourceFiles.set(relative(root, path).replaceAll("\\", "/"), source.split(/\r?\n/).length);
    }
  }
}

async function checkCoverage() {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const packages = join(root, "packages");
  const sourceFiles = new Map();
  for (const entry of await readdir(packages, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await readSourceFiles(join(packages, entry.name, "src"), root, sourceFiles);
    }
  }
  const report = await readFile(join(root, "coverage", "lcov.info"), "utf8");
  const count = validateLcov(report, sourceFiles);
  log(`Coverage maps ${count} production TypeScript files exactly once`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await checkCoverage();
}
