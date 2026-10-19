import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import test from "node:test";

test("resolves root and metadata declarations with Obo's production compiler settings", async () => {
  const temporaryRoot = resolve(tmpdir());
  const fixture = await mkdtemp(join(temporaryRoot, "obo-sdk-types-"));
  // Only clean up the unique fixture allocated directly under the system temp directory.
  if (dirname(resolve(fixture)) !== temporaryRoot) throw new Error("Unsafe fixture cleanup path");
  try {
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    const scope = join(fixture, "node_modules", "@oboapp");
    await mkdir(scope, { recursive: true });
    await symlink(packageRoot, join(scope, "source-sdk"), "junction");
    await writeFile(join(fixture, "consumer.ts"), `
      import { serializeDiscoveryPayload } from "@oboapp/source-sdk";
      import type { SourceMetadata } from "@oboapp/source-sdk/metadata";
      const metadata: SourceMetadata = { id: "example", name: "Example", url: "https://example.com", localities: ["bg.sofia"] };
      const encoded: string = serializeDiscoveryPayload(metadata.id);
      void encoded;
    `);
    const require = createRequire(import.meta.url);
    assert.doesNotThrow(() => execFileSync(process.execPath, [
      require.resolve("typescript/bin/tsc"), join(fixture, "consumer.ts"),
      "--module", "commonjs", "--moduleResolution", "node", "--target", "ES2022",
      "--strict", "--skipLibCheck", "--noEmit",
    ], { encoding: "utf8", stdio: "pipe" }));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
