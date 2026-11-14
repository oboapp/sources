import type { SourceContent } from "@oboapp/source-sdk";
import { buildMarkdownText, buildMessageText, buildTimespan, buildTitle } from "./builders.js";
import type { WeatherPageData } from "./types.js";

export function buildContent(data: WeatherPageData): SourceContent {
  const timespan = buildTimespan(data.forecastDate);
  return {
    title: buildTitle(data),
    message: buildMessageText(data),
    markdownText: buildMarkdownText(data),
    datePublished: data.issuedAt,
    timespanStart: timespan.start.toISOString(),
    timespanEnd: timespan.end.toISOString(),
    geoJson: { type: "FeatureCollection", features: [] },
    categories: ["weather"],
    isRelevant: true,
    cityWide: true,
  };
}
