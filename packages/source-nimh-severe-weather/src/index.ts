import type { CreateSource } from "@oboapp/source-sdk";
import { chromium } from "playwright";
import { metadata } from "./metadata.js";
import { createNimhSource } from "./nimh.js";

export const createSource: CreateSource = (context) => {
  if (!metadata.localities.includes(context.locality)) {
    throw new Error(`Unsupported NIMH locality: ${context.locality}`);
  }
  return createNimhSource({
    launchBrowser() {
      return chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });
    },
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  });
};
