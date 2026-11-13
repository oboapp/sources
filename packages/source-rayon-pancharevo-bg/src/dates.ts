import { parseBulgarianDate } from "@oboapp/source-web-utils/browser";

const bulgarianMonths: Record<string, number> = {
  януари: 1,
  февруари: 2,
  март: 3,
  април: 4,
  май: 5,
  юни: 6,
  юли: 7,
  август: 8,
  септември: 9,
  октомври: 10,
  ноември: 11,
  декември: 12,
};

function buildDate(year: number, month: number, day: number): Date {
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    throw new Error(`Invalid date: ${day}.${month}.${year}`);
  }
  return date;
}

function removeParenthesizedText(text: string): string {
  let depth = 0;
  let result = "";
  for (const character of text) {
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      if (depth > 0) {
        depth -= 1;
      } else {
        result += character;
      }
      continue;
    }
    if (depth === 0) {
      result += character;
    }
  }
  return result;
}

export function extractDateCandidate(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const patterns = [
    /(\d{1,2}\.\d{1,2}\s*-\s*\d{1,2}\.\d{1,2}\.\d{2,4})/i,
    /(\d{1,2}\s*-\s*\d{1,2}\.\d{1,2}\.\d{2,4})/i,
    /(\d{1,2}\.\d{1,2}\.\d{2,4})/i,
    /(\d{1,2}\s+[а-яА-Я]+(?:\s*\([^)]*\))?\s+\d{4}(?:\s*г\.)?)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export function parseBulgarianDateOrRange(dateText: string): { start: Date; end: Date } {
  const normalized = removeParenthesizedText(dateText.trim().toLowerCase())
    .replace(/\s+/g, " ")
    .trim();
  const crossMonth = /(\d{1,2})\.(\d{1,2})\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(normalized);
  if (crossMonth) {
    const [, startDay = "", startMonth = "", endDay = "", endMonth = "", yearText = ""] = crossMonth;
    const year = Number.parseInt(yearText, 10) + (yearText.length === 2 ? 2000 : 0);
    return {
      start: buildDate(year, Number.parseInt(startMonth, 10), Number.parseInt(startDay, 10)),
      end: buildDate(year, Number.parseInt(endMonth, 10), Number.parseInt(endDay, 10)),
    };
  }
  const sameMonth = /(\d{1,2})\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(normalized);
  if (sameMonth) {
    const [, startDay = "", endDay = "", monthText = "", yearText = ""] = sameMonth;
    const year = Number.parseInt(yearText, 10) + (yearText.length === 2 ? 2000 : 0);
    const month = Number.parseInt(monthText, 10);
    return {
      start: buildDate(year, month, Number.parseInt(startDay, 10)),
      end: buildDate(year, month, Number.parseInt(endDay, 10)),
    };
  }
  const numeric = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(normalized);
  if (numeric) {
    const [, dayText = "", monthText = "", yearText = ""] = numeric;
    const year = Number.parseInt(yearText, 10) + (yearText.length === 2 ? 2000 : 0);
    const date = buildDate(year, Number.parseInt(monthText, 10), Number.parseInt(dayText, 10));
    return { start: date, end: date };
  }
  const monthName = /(\d{1,2})\s+([а-я]+)\s+(\d{4})/.exec(normalized);
  if (monthName) {
    const [, dayText = "", name = "", yearText = ""] = monthName;
    const month = bulgarianMonths[name];
    if (!month) {
      throw new Error(`Unsupported Bulgarian month: ${name}`);
    }
    const date = buildDate(Number.parseInt(yearText, 10), month, Number.parseInt(dayText, 10));
    return { start: date, end: date };
  }
  throw new Error(`Unable to parse Bulgarian date text: ${dateText}`);
}

export function isDateRelevant(
  range: { start: Date; end: Date },
  referenceDate = new Date(),
): boolean {
  const reference = new Date(referenceDate);
  reference.setHours(0, 0, 0, 0);
  const start = new Date(range.start);
  start.setHours(0, 0, 0, 0);
  const end = new Date(range.end);
  end.setHours(0, 0, 0, 0);
  return reference >= start && reference <= end;
}

export function parsePancharevoDateToIso(dateText: string): string {
  const candidate = extractDateCandidate(dateText);
  if (candidate) {
    return parseBulgarianDateOrRange(candidate).start.toISOString();
  }
  return parseBulgarianDate(dateText);
}
