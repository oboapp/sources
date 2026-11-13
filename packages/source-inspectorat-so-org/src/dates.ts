const MAX_FUTURE_DAYS_FOR_SHORT_DATE = 7;

const BG_MONTH_TO_NUMBER: Record<string, string> = {
  ян: "01",
  фев: "02",
  март: "03",
  апр: "04",
  май: "05",
  юни: "06",
  юли: "07",
  авг: "08",
  сеп: "09",
  окт: "10",
  ное: "11",
  дек: "12",
};

function inferShortDateYear(day: string, month: string, referenceDate: Date): number {
  const currentYear = referenceDate.getFullYear();
  const candidateThisYear = new Date(`${currentYear}-${month}-${day}T00:00:00+02:00`);
  if (Number.isNaN(candidateThisYear.getTime())) {
    return currentYear;
  }
  const futureThresholdMs = MAX_FUTURE_DAYS_FOR_SHORT_DATE * 24 * 60 * 60 * 1000;
  const isTooFarInFuture = candidateThisYear.getTime() - referenceDate.getTime() > futureThresholdMs;
  return isTooFarInFuture ? currentYear - 1 : currentYear;
}

/** Preserve the provider's abbreviated dates, listing fallback and fixed +02:00 offset. */
export function parseInspectoratDate(
  dateText: string,
  fallbackDateText?: string,
  referenceDate = new Date(),
): string {
  const candidate = (dateText || fallbackDateText || "").replace(/\s+/g, " ").trim();
  const directMatch = /(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(candidate);
  if (directMatch) {
    const [, dayRaw = "", monthRaw = "", yearRaw = ""] = directMatch;
    const day = dayRaw.padStart(2, "0");
    const month = monthRaw.padStart(2, "0");
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    const parsed = new Date(`${year}-${month}-${day}T00:00:00+02:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  const shortMonthMatch = /(\d{1,2})\s*([а-я]+)/i.exec(candidate);
  if (shortMonthMatch) {
    const [, dayRaw = "", monthRaw = ""] = shortMonthMatch;
    const mappedMonth = BG_MONTH_TO_NUMBER[monthRaw.toLowerCase().replace(/\.$/, "")];
    if (mappedMonth) {
      const day = dayRaw.padStart(2, "0");
      const year = inferShortDateYear(day, mappedMonth, referenceDate);
      const parsed = new Date(`${year}-${mappedMonth}-${day}T00:00:00+02:00`);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }
  return new Date().toISOString();
}
