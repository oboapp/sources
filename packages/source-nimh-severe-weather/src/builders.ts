import { createHash } from "node:crypto";
import type { WeatherPageData, WarningCell, WarningType } from "./types.js";

/**
 * Human-readable labels for warning types in Bulgarian (short form for headings)
 */
const WARNING_TYPE_LABELS: Record<WarningType, string> = {
  high_temperature: "температура",
  low_temperature: "температура",
  wind: "вятър",
  rain: "дъжд",
  snow_ice: "сняг",
};

/**
 * Generate a content hash for deduplication
 * Hash changes only when structured warning data changes (e.g., yellow → orange)
 * and ignores free-form recommendation prose updates.
 */
export function buildContentHash(data: WeatherPageData): string {
  const sortedWarnings = [...data.sofiaWarnings].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type.localeCompare(b.type);
    }
    if (a.level !== b.level) {
      return a.level.localeCompare(b.level);
    }
    return a.notes.join(";").localeCompare(b.notes.join(";"));
  });

  return createHash("sha256")
    .update(JSON.stringify(sortedWarnings))
    .digest("hex")
    .substring(0, 12);
}

/**
 * Build the source URL for a warning
 * Includes content hash to ensure unique URL per warning update
 */
export function buildUrl(data: WeatherPageData): string {
  const hash = buildContentHash(data);
  return `https://weather.bg/obshtini/index.php?z=u&o=SOF&date=${data.forecastDate}&h=${hash}`;
}

/**
 * Build a title for the warning
 */
export function buildTitle(data: WeatherPageData): string {
  const date = formatDateBulgarian(data.forecastDate);
  return `Предупреждение за опасно време - ${date}`;
}

/**
 * Human-readable labels for warning levels in Bulgarian
 */
const WARNING_LEVEL_LABELS: Record<string, string> = {
  green: "Зелен код",
  yellow: "Жълт код",
  orange: "Оранжев код",
  red: "Червен код",
};

/**
 * Build markdown text for display
 * Groups warnings by level (most severe first), filters out green
 * Format: "**Червен код за температура**"
 */
export function buildMarkdownText(data: WeatherPageData): string {
  const parts: string[] = [];

  // Filter out green warnings and sort by severity (red > orange > yellow)
  const activeWarnings = data.sofiaWarnings
    .filter((w) => w.level !== "green")
    .sort((a, b) => {
      const levels = ["yellow", "orange", "red"];
      return levels.indexOf(b.level) - levels.indexOf(a.level);
    });

  if (activeWarnings.length > 0) {
    // Add heading with date and highest warning level
    const maxLevel = getMaxWarningLevel(activeWarnings);
    const levelLabel =
      WARNING_LEVEL_LABELS[maxLevel] || WARNING_LEVEL_LABELS.yellow;
    const dateWithDay = formatDateWithDayOfWeek(data.forecastDate);
    parts.push(`**${levelLabel} за опасно време за ${dateWithDay}**`, "");
  }

  // Add recommendation if present
  if (data.recommendation) {
    parts.push(data.recommendation, "");
  }

  // Group warnings by level and type
  for (const warning of activeWarnings) {
    const levelLabel = WARNING_LEVEL_LABELS[warning.level];
    const typeLabel = WARNING_TYPE_LABELS[warning.type];
    const noteLines = warning.notes.map((note) => `- ${note}`);

    if (noteLines.length > 0) {
      parts.push(`**${levelLabel} за ${typeLabel}**`, ...noteLines, "");
    } else {
      parts.push(`**${levelLabel} за ${typeLabel}**`, "");
    }
  }

  return parts.join("\n").trim();
}

/**
 * Build plain text message (for text field)
 */
export function buildMessageText(data: WeatherPageData): string {
  const parts: string[] = [];

  // Filter out green warnings
  const activeWarnings = data.sofiaWarnings.filter((w) => w.level !== "green");

  if (activeWarnings.length === 0) {
    return data.recommendation || "";
  }

  // Build heading from highest level with date
  const maxLevel = getMaxWarningLevel(activeWarnings);
  const levelLabel =
    WARNING_LEVEL_LABELS[maxLevel] || WARNING_LEVEL_LABELS.yellow;
  const dateWithDay = formatDateWithDayOfWeek(data.forecastDate);
  parts.push(`${levelLabel} за опасно време за ${dateWithDay}`);

  if (data.recommendation) {
    parts.push("", data.recommendation);
  }

  // Collect all notes
  const allNotes = data.sofiaWarnings.flatMap((w) => w.notes);
  if (allNotes.length > 0) {
    parts.push("", allNotes.join("; "));
  }

  return parts.join("\n").trim();
}

/**
 * Get day of week in Bulgarian
 */
function getDayOfWeek(isoDate: string): string {
  const days = [
    "неделя",
    "понеделник",
    "вторник",
    "сряда",
    "четвъртък",
    "петък",
    "събота",
  ];

  // Parse ISO date string explicitly to avoid timezone issues
  const [year, month, day] = isoDate.split("-").map(Number);
  // Create date in UTC to ensure consistent day calculation
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return days[date.getUTCDay()]!;
}

/**
 * Format date in Bulgarian format (e.g., "01 февруари 2026")
 */
function formatDateBulgarian(isoDate: string): string {
  const months = [
    "януари",
    "февруари",
    "март",
    "април",
    "май",
    "юни",
    "юли",
    "август",
    "септември",
    "октомври",
    "ноември",
    "декември",
  ];

  const [year, month, day] = isoDate.split("-");
  return `${Number.parseInt(day!, 10)} ${months[Number.parseInt(month!, 10) - 1]} ${year}`;
}

/**
 * Format date with day of week in short format (e.g., "17.02.2026 (вторник)")
 */
function formatDateWithDayOfWeek(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  const dayOfWeek = getDayOfWeek(isoDate);
  return `${day}.${month}.${year} (${dayOfWeek})`;
}

/**
 * Build timespan from forecast date
 * Weather warnings typically cover the full forecast day
 */
export function buildTimespan(forecastDate: string): {
  start: Date;
  end: Date;
} {
  // Preserve the legacy fixed offset, including dates during daylight saving time.
  const start = new Date(`${forecastDate}T00:00:00+02:00`);
  const end = new Date(`${forecastDate}T23:59:59+02:00`);

  return { start, end };
}

/**
 * Get the highest warning level from all warnings
 */
export function getMaxWarningLevel(warnings: WarningCell[]): string {
  const levels = ["green", "yellow", "orange", "red"];
  let maxIndex = 0;

  for (const warning of warnings) {
    const index = levels.indexOf(warning.level);
    if (index > maxIndex) {
      maxIndex = index;
    }
  }

  return levels[maxIndex]!;
}
