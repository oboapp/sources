import type { CreateSource } from "@oboapp/source-sdk";
import { createErmZapadSource } from "./erm-zapad.js";
import { metadata } from "./metadata.js";

export const createSource: CreateSource = (context) => {
  if (!metadata.localities.includes(context.locality)) {
    throw new Error(`Unsupported ERM Zapad locality: ${context.locality}`);
  }
  return createErmZapadSource({
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  });
};
