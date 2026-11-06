import type { SourceContent } from "@oboapp/source-sdk";
import type { ToploIncident } from "./parser.js";

const MINIMUM_DATE = Date.UTC(2025, 0, 1);

function formatDate(value: string): string {
  return new Date(value).toLocaleString("bg-BG", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timespanDate(value: string | null, fallback: Date): Date {
  const parsed = value ? new Date(value) : fallback;
  return parsed.getTime() >= MINIMUM_DATE ? parsed : fallback;
}

export function buildContent(incident: ToploIncident): SourceContent {
  const parts = [incident.name, "", formatDate(incident.fromDate), incident.addresses];
  if (incident.untilDate) {
    parts.push("", `Очаквано възстановяване на ${formatDate(incident.untilDate)}`);
  }
  const message = parts.join("\n");
  const timespanStart = timespanDate(incident.fromDate, new Date());
  const timespanEnd = timespanDate(incident.untilDate, timespanStart);
  return {
    title: incident.name,
    message,
    markdownText: message,
    datePublished: incident.fromDate,
    timespanStart: timespanStart.toISOString(),
    timespanEnd: timespanEnd.toISOString(),
    deepLinkUrl: "",
    geoJson: incident.geoJson,
    categories: ["heating"],
    isRelevant: true,
  };
}
