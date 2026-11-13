import type { CreateSource } from "@oboapp/source-sdk";
import { createSofiyskaVodaSource } from "./sofiyska-voda.js";

export const createSource: CreateSource = (context) => createSofiyskaVodaSource({
  fetch: (...args) => globalThis.fetch(...args),
  ...(context.signal === undefined ? {} : { signal: context.signal }),
});
