import { copyFile, writeFile } from "node:fs/promises";
import { URL } from "node:url";

await writeFile(new URL("../dist/cjs/package.json", import.meta.url), '{"type":"commonjs"}\n');
await copyFile(new URL("../../../LICENSE", import.meta.url), new URL("../LICENSE", import.meta.url));
