import type { Reading } from "./readings.js";

// The alert thresholds use the historical interpolated EAQI bands. Keep
// these values aligned with the status API when revising the index.
const pm25Edges = [0, 10, 20, 25, 50, 75, 800];
const pm10Edges = [0, 20, 40, 50, 100, 150, 1200];
const labels = ["Добро", "Задоволително", "Умерено", "Лошо", "Много лошо", "Изключително лошо"];

function bandIndex(value: number, edges: number[]): number {
  for (let i = 1; i < edges.length; i++) {
    const low = edges[i - 1]!;
    const high = edges[i]!;
    if (value < high) {
      return i + ((value - low) / (high - low)) * 0.99;
    }
  }
  return 6;
}

function nowCast(values: number[]): number {
  const max = Math.max(...values);
  const range = max - Math.min(...values);
  const weight = max > 0 ? Math.max(1 - range / max, 0.5) : 1;
  let sum = 0;
  let weights = 0;
  for (const [hour, value] of values.entries()) {
    const w = weight ** hour;
    sum += value * w;
    weights += w;
  }
  return sum / weights;
}

export function airQualityIndex(readings: readonly Reading[]): number {
  if (readings.length === 0) {
    return 0;
  }
  const bins = new Map<number, { p1: number; p2: number; count: number }>();
  for (const reading of readings) {
    const hour = Math.floor(reading.timestamp.getTime() / 3_600_000);
    const bin = bins.get(hour) ?? { p1: 0, p2: 0, count: 0 };
    bin.p1 += reading.p1;
    bin.p2 += reading.p2;
    bin.count++;
    bins.set(hour, bin);
  }
  const hours = [...bins.entries()].sort(([left], [right]) => right - left);
  const pm25 = nowCast(hours.map(([, bin]) => bin.p2 / bin.count));
  const pm10 = nowCast(hours.map(([, bin]) => bin.p1 / bin.count));
  const index = Math.max(bandIndex(pm25, pm25Edges), bandIndex(pm10, pm10Edges));
  return Math.min(Math.round(index * 10) / 10, 6);
}

export function airQualityLabel(index: number): string {
  return labels[Math.floor(index) - 1]!;
}
