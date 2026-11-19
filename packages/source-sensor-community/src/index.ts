import type { DataSource, SourceContent, SourceContext } from "@oboapp/source-sdk";
import { airQualityIndex, airQualityLabel } from "./aqi.js";
import { buildGrid, cellGeometry, contains, type Bounds, type Cell } from "./grid.js";
import { filterOutliers } from "./outliers.js";
import type { Reading } from "./readings.js";

export type { Bounds, Reading };

export interface ReadingsInput {
  readonly bounds: Bounds;
  /** Return stored readings in the inclusive UTC interval. */
  readonly readReadings: (locality: string, start: Date, end: Date) => Promise<readonly Reading[]>;
}

const hour = 3_600_000;
const halfHour = hour / 2;

function cellAlert(cell: Cell, readings: Reading[], midpoint: Date, now: Date): SourceContent | undefined {
  const filtered = filterOutliers(readings);
  const current = filtered.filter((reading) => reading.timestamp >= midpoint);
  const sensors = new Set(current.map((reading) => reading.sensorId)).size;
  // The historical 50% coverage requirement over two hours needs one hourly
  // bin, which any nonempty current set provides.
  if (sensors < 3 || !current.some((reading) => now.getTime() - reading.timestamp.getTime() <= 45 * 60_000)) {
    return undefined;
  }
  const index = airQualityIndex(current);
  if (index < 4) {
    return undefined;
  }
  const immediate = index >= 5;
  if (!immediate && airQualityIndex(filtered.filter((reading) => reading.timestamp < midpoint)) < 4) {
    return undefined;
  }
  const typeNote = immediate ? "Рязко влошаване" : "Продължително влошаване";
  const healthNote = immediate
    ? "Ограничи престоя на открито, особено при дихателни или сърдечни заболявания."
    : "Хора с дихателни или сърдечни заболявания може да усетят влошаване на симптомите.";
  const label = airQualityLabel(index);
  const pm25 = (current.reduce((sum, reading) => sum + reading.p2, 0) / current.length).toFixed(1);
  const pm10 = (current.reduce((sum, reading) => sum + reading.p1, 0) / current.length).toFixed(0);
  return {
    title: `Влошено качество на въздуха – ${cell.id}`,
    message: `${typeNote} на качеството на въздуха. Европейски индекс: ${label}. ` +
      `PM2.5: ${pm25}, PM10: ${pm10} μg/m³. Измерено от ${sensors} сензора от мрежата sensor.community. ${healthNote}`,
    markdownText: `**${typeNote}** на качеството на въздуха\n\n` +
      "Данните от гражданската мрежа [sensor.community](https://sensor.community/) " +
      "показват влошаване на качеството на въздуха в този район.\n\n" +
      `- Европейски индекс за качество на въздуха: **${label}**\n` +
      `- PM2.5: ${pm25} μg/m³\n- PM10: ${pm10} μg/m³\n` +
      `- Измерено от ${sensors} независими сензора\n\n⚠️ ${healthNote}`,
    datePublished: now.toISOString(),
    timespanStart: midpoint.toISOString(),
    timespanEnd: now.toISOString(),
    deepLinkUrl: "",
    geoJson: cellGeometry(cell.bounds),
    categories: ["air-quality"],
    isRelevant: true,
  };
}

/** Bind an instance's locality bounds and its existing rolling readings store. */
export function createSource({ locality }: SourceContext, input: ReadingsInput): DataSource {
  const cells = buildGrid(input.bounds);
  const alerts = new Map<string, SourceContent>();
  return {
    async discoverItems() {
      alerts.clear();
      const now = new Date();
      const start = new Date(now.getTime() - 4 * hour);
      const midpoint = new Date(now.getTime() - 2 * hour);
      const windowId = Math.floor(now.getTime() / halfHour) * halfHour;
      const groups = new Map<Cell, Reading[]>();
      for (const reading of await input.readReadings(locality, start, now)) {
        if (!(reading.timestamp >= start && reading.timestamp <= now)) {
          continue;
        }
        const cell = cells.find((candidate) => contains(candidate, reading.lat, reading.lng));
        if (cell) {
          const group = groups.get(cell) ?? [];
          group.push(reading);
          groups.set(cell, group);
        }
      }
      for (const [cell, readings] of groups) {
        const content = cellAlert(cell, readings, midpoint, now);
        if (content) {
          alerts.set(`sensor-community://${locality}/${cell.id}/${windowId}`, content);
        }
      }
      return { items: Array.from(alerts.keys(), (identifier) => ({ identifier })) };
    },
    async fetchItem({ identifier }) {
      const content = alerts.get(identifier);
      if (!content) {
        throw new Error(`Unknown Sensor.Community alert in this scan: ${identifier}`);
      }
      return content;
    },
    async close() {
      alerts.clear();
    },
  };
}
