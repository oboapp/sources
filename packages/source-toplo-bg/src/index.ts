import type { CreateSource } from "@oboapp/source-sdk";
import { createToploSource } from "./toplo.js";

export const createSource: CreateSource = (context) => createToploSource({
  fetch: (...args) => globalThis.fetch(...args),
  ...(context.signal === undefined ? {} : { signal: context.signal }),
});
