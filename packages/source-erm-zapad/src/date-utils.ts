/** Preserve the collector's ambient local-time interpretation. */
export function parseBulgarianDateTime(dateStr: string): Date {
  if (!dateStr || typeof dateStr !== "string") {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  const match = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/.exec(dateStr.trim());
  if (!match) {
    throw new Error(`Date string does not match Bulgarian format "DD.MM.YYYY HH:MM": ${dateStr}`);
  }
  const [, day, month, year, hour, minute] = match;
  const parsedDay = Number.parseInt(day!, 10);
  const parsedMonth = Number.parseInt(month!, 10) - 1;
  const parsedYear = Number.parseInt(year!, 10);
  const parsedHour = Number.parseInt(hour!, 10);
  const parsedMinute = Number.parseInt(minute!, 10);
  if (parsedMonth < 0 || parsedMonth > 11) {
    throw new Error(`Invalid month: ${month}`);
  }
  if (parsedDay < 1 || parsedDay > 31) {
    throw new Error(`Invalid day: ${day}`);
  }
  if (parsedHour < 0 || parsedHour > 23) {
    throw new Error(`Invalid hour: ${hour}`);
  }
  if (parsedMinute < 0 || parsedMinute > 59) {
    throw new Error(`Invalid minute: ${minute}`);
  }
  const date = new Date(parsedYear, parsedMonth, parsedDay, parsedHour, parsedMinute, 0, 0);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid date: ${dateStr}`);
  }
  if (
    date.getDate() !== parsedDay ||
    date.getMonth() !== parsedMonth ||
    date.getFullYear() !== parsedYear
  ) {
    throw new Error(`Invalid date (out of range): ${dateStr}`);
  }
  return date;
}
