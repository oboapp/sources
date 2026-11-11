import { parseBulgarianMonthDate } from "@oboapp/source-web-utils/browser";

/** Preserve ISO dates, Bulgarian month names and the legacy current-time fallback. */
export function parsePublicationDate(dateText: string): string {
  const cleaned = dateText.replace(/^Публикувано:\s*/i, "").trim();
  if (!cleaned) {
    return new Date().toISOString();
  }

  const isoDate = new Date(cleaned);
  if (!Number.isNaN(isoDate.getTime())) {
    return isoDate.toISOString();
  }

  return parseBulgarianMonthDate(cleaned);
}
