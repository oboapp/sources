import { setTimeout as wait } from "node:timers/promises";
import type { DataSource, SourceContext } from "@oboapp/source-sdk";
import TurndownService from "turndown";
import { extractPostDetailsFromHtml } from "./content.js";
import { feedUrl, parseIdentifiers, SITE_HOST } from "./discovery.js";
import { readPortal, type HttpOptions } from "./http.js";

const sections = ["actualmessages", "actualnews", "actualevents"];

interface SourceOptions extends HttpOptions {
  onSectionFailure?: (section: string, error: unknown) => void | Promise<void>;
}

export function parsePublicationDate(text: string): string {
  const label = "дата на публикуване";
  const labelIndex = text.toLowerCase().indexOf(label);
  const publication = labelIndex < 0 ? "" : text.slice(labelIndex + label.length);
  const pattern = /\d{2}\.\d{2}\.\d{4}/;
  const value = pattern.exec(publication)?.[0] ?? pattern.exec(text)?.[0] ?? text.trim();
  const parts = value.replaceAll("/", ".").split(".");
  const [day, month, year] = parts;
  if (parts.length === 3 && day && month && year) {
    const date = new Date(`${year.length === 2 ? "20" + year : year}-${month}-${day}`);
    if (Number.isFinite(date.getTime())) {
      return date.toISOString();
    }
  }
  return new Date().toISOString();
}

export function createSource({ signal }: SourceContext, options: SourceOptions = {}): DataSource {
  const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  let failures: unknown[] = [];
  return {
    async discoverItems(cursor) {
      const section = cursor ?? sections[0]!;
      const index = sections.indexOf(section);
      if (index < 0) {
        throw new Error("Unknown Serdika section cursor");
      }
      if (cursor === undefined) {
        failures = [];
      }
      let urls: string[] = [];
      try {
        const xml = await readPortal(feedUrl(section), true, options, signal);
        urls = parseIdentifiers(xml);
      } catch (error) {
        signal?.throwIfAborted();
        failures.push(error);
        try {
          await options.onSectionFailure?.(section, error);
        } catch {
          // A reporting failure should not prevent collection of the next section.
        }
      }
      if (failures.length === sections.length) {
        throw new AggregateError(failures, "Every Serdika section failed");
      }
      const items = urls.map((identifier) => ({ identifier }));
      const nextCursor = sections[index + 1];
      return nextCursor ? { items, nextCursor } : { items };
    },
    async fetchItem({ identifier }) {
      const url = new URL(identifier);
      if (url.hostname !== new URL(SITE_HOST).hostname || !["http:", "https:"].includes(url.protocol)) {
        throw new Error("Unexpected host in a Serdika notice link");
      }
      try {
        const html = await readPortal(identifier, false, options, signal);
        const { title, dateText, contentHtml } = extractPostDetailsFromHtml(html, identifier);
        if (!title) {
          throw new Error(`Failed to extract title from ${identifier}`);
        }
        return {
          title,
          datePublished: parsePublicationDate(dateText),
          message: markdown.turndown(contentHtml),
        };
      } finally {
        if (!signal?.aborted) {
          await (options.delay ?? wait)(2_000);
        }
      }
    },
  };
}
