import type { DataSource } from "@oboapp/source-sdk";
import type { Browser } from "playwright";
import { buildUrl } from "./builders.js";
import { buildContent } from "./content.js";
import { metadata } from "./metadata.js";
import { hasActiveWarnings, parseWeatherPage } from "./parser.js";
import type { WeatherPageData } from "./types.js";

export interface NimhDependencies {
  launchBrowser: () => Promise<Browser>;
  signal?: AbortSignal;
  warn?: (message: string) => void;
}

/** Browser serialization preserves the legacy warning notes and identifier hash. */
export function createNimhSource(dependencies: NimhDependencies): DataSource {
  let browser: Browser | undefined;
  let cached: { identifier: string; data: WeatherPageData } | undefined;
  let closed = false;
  const warn = dependencies.warn ?? ((message: string) => {
    globalThis.console.warn(message);
  });

  function assertOpen(): void {
    dependencies.signal?.throwIfAborted();
    if (closed) {
      throw new Error("NIMH source is closed");
    }
  }

  async function close(): Promise<void> {
    closed = true;
    cached = undefined;
    dependencies.signal?.removeEventListener("abort", onAbort);
    const current = browser;
    browser = undefined;
    await current?.close();
  }

  function onAbort(): void {
    void close().catch((error: unknown) => {
      warn(`Failed to close NIMH browser: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  dependencies.signal?.addEventListener("abort", onAbort, { once: true });

  return {
    async discoverItems(cursor) {
      cached = undefined;
      assertOpen();
      if (cursor !== undefined) {
        throw new Error("NIMH discovery does not support pagination cursors");
      }
      const current = await dependencies.launchBrowser();
      browser = current;
      let html: string;
      try {
        assertOpen();
        const page = await current.newPage();
        const response = await page.goto(metadata.url, {
          waitUntil: "networkidle",
          timeout: 30_000,
        });
        if (response && !response.ok()) {
          throw new Error(`NIMH listing returned HTTP ${response.status()}`);
        }
        html = await page.content();
        assertOpen();
      } finally {
        if (browser === current) {
          browser = undefined;
          await current.close();
        } else if (!closed) {
          await current.close();
        }
      }
      assertOpen();
      const data = parseWeatherPage(html, warn);
      if (!data) {
        throw new Error("Failed to parse NIMH weather page");
      }
      if (!hasActiveWarnings(data)) {
        return { items: [] };
      }
      const identifier = buildUrl(data);
      cached = { identifier, data };
      return { items: [{ identifier }] };
    },
    async fetchItem(item) {
      assertOpen();
      if (!cached || cached.identifier !== item.identifier) {
        throw new Error(`Missing NIMH listing content for ${item.identifier}`);
      }
      return buildContent(cached.data);
    },
    close,
  };
}
