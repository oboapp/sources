import { parseBulgarianDateTime } from "./date-utils.js";
import type { PinRecord, Warn } from "./types.js";

const MINIMUM_TIMESPAN = Date.UTC(2025, 0, 1);

export function parseTimespans(
  pin: PinRecord,
  now = new Date(),
  warn: Warn = () => {},
): { timespanStart: Date; timespanEnd: Date } {
  let timespanStart = now;
  let timespanEnd = now;
  try {
    if (pin.begin_event) {
      const parsed = parseBulgarianDateTime(pin.begin_event);
      if (parsed.getTime() >= MINIMUM_TIMESPAN) {
        timespanStart = parsed;
      } else {
        warn(`begin_event outside valid range for ${pin.eventId}: ${pin.begin_event}`);
      }
    }
  } catch (error) {
    warn(`Invalid begin_event for ${pin.eventId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    if (pin.end_event) {
      const parsed = parseBulgarianDateTime(pin.end_event);
      if (parsed.getTime() >= MINIMUM_TIMESPAN) {
        timespanEnd = parsed;
      } else {
        warn(`end_event outside valid range for ${pin.eventId}: ${pin.end_event}`);
        timespanEnd = timespanStart;
      }
    } else if (pin.begin_event) {
      timespanEnd = timespanStart;
    }
  } catch (error) {
    warn(`Invalid end_event for ${pin.eventId}: ${error instanceof Error ? error.message : String(error)}`);
    timespanEnd = timespanStart;
  }
  return { timespanStart, timespanEnd };
}
