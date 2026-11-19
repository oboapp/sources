import type { CreateSource, SourceContent } from "@oboapp/source-sdk";
import { decode } from "html-entities";
import TurndownService from "turndown";

// The old Joomla listing showed the six most recent notices. July 3 is the
// first WordPress notice. Older imported records need their Joomla identifiers.
const listing = new URL("https://krasnapolyana.bg/wp-json/wp/v2/notifications");
listing.search = new URLSearchParams({
  per_page: "6",
  after: "2026-07-02T23:59:59",
  orderby: "date",
  order: "desc",
  _fields: "link,title,content,date_gmt",
}).toString();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function noticeIdentifier(notice: unknown): string {
  if (!isRecord(notice) || typeof notice.link !== "string") {
    throw new Error("Krasna Polyana notice has no public link");
  }
  const url = new URL(notice.link);
  if (url.origin !== listing.origin || !/^\/notifications\/[^/]+\/?$/.test(url.pathname)) {
    throw new Error("Unexpected Krasna Polyana notice link");
  }
  return notice.link;
}

function rendered(field: unknown): string {
  if (!isRecord(field) || field.protected === true || typeof field.rendered !== "string") {
    return "";
  }
  return field.rendered.trim();
}

function readContent(notice: unknown, markdown: TurndownService): SourceContent {
  if (!isRecord(notice) || typeof notice.date_gmt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(notice.date_gmt)) {
    throw new Error("Missing WordPress UTC publication time");
  }
  const date = new Date(notice.date_gmt + "Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== notice.date_gmt) {
    throw new Error("Invalid WordPress UTC publication time");
  }
  const title = decode(rendered(notice.title)).trim();
  const message = markdown.turndown(rendered(notice.content)).trim();
  if (!title || !message) {
    throw new Error("Krasna Polyana notice is missing its title or public content");
  }
  return { title, message, datePublished: date.toISOString() };
}

export const createSource: CreateSource = ({ signal }) => {
  const notices = new Map<string, unknown>();
  const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  markdown.remove(["script", "style"]);
  return {
    async discoverItems() {
      notices.clear();
      const timeout = AbortSignal.timeout(30_000);
      const response = await fetch(listing, {
        headers: { Accept: "application/json" },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) {
        throw new Error(`Krasna Polyana discovery returned HTTP ${response.status}`);
      }
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) {
        throw new TypeError("Expected an array of WordPress notices");
      }
      for (const row of rows) {
        const identifier = noticeIdentifier(row);
        if (!notices.has(identifier)) {
          notices.set(identifier, row);
        }
      }
      return { items: Array.from(notices.keys(), (identifier) => ({ identifier })) };
    },
    async fetchItem({ identifier }) {
      if (!notices.has(identifier)) {
        throw new Error("Krasna Polyana notice was not discovered in this scan");
      }
      return readContent(notices.get(identifier), markdown);
    },
    async close() {
      notices.clear();
    },
  };
};
