import type { DataSource, SourceContext } from "@oboapp/source-sdk";
import { createHybridSource } from "./hybrid.js";
import type { SourceOptions } from "./options.js";

export type { SourceOptions } from "./options.js";

export function createSource(_context: SourceContext, options: SourceOptions = {}): DataSource {
  return createHybridSource(undefined, options);
}
