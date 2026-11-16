const MAX_ERROR_DEPTH = 6;
const MAX_ERROR_NODES = 16;
const MAX_AGGREGATE_ERRORS = 8;
const NETWORK_FIELDS = ["code", "errno", "syscall"];
const PAGINATION_KEYS = new Set(["paged", "page", "start"]);

function isSafeFeedParameter(key: string, value: string): boolean {
  if (PAGINATION_KEYS.has(key)) {
    return /^\d{1,16}$/.test(value);
  }
  if (key === "format") {
    return value === "feed";
  }
  if (key === "type") {
    return value === "rss" || value === "atom";
  }
  return key === "feed" && ["rss", "rss2", "atom"].includes(value);
}

/** Diagnostic URLs retain only known public feed and pagination parameters. */
export function diagnosticFeedUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "[invalid feed URL]";
    }
    const parameters = new URLSearchParams();
    for (const [key, parameter] of url.searchParams) {
      if (isSafeFeedParameter(key, parameter)) {
        parameters.append(key, parameter);
      }
    }
    url.username = "";
    url.password = "";
    url.hash = "";
    url.search = parameters.toString();
    return url.toString().slice(0, 8_192);
  } catch {
    return "[invalid feed URL]";
  }
}

export function diagnosticPagination(url: string): string | undefined {
  try {
    const parameters = [...new URL(diagnosticFeedUrl(url)).searchParams]
      .filter(([key]) => {
        return PAGINATION_KEYS.has(key);
      })
      .map(([key, value]) => {
        return `${key}=${value}`;
      });
    return parameters.length > 0 ? parameters.join(", ") : undefined;
  } catch {
    return undefined;
  }
}

/** Keep pagination outside URL text for loggers that remove every URL query. */
export function describeFeedUrl(url: string): string {
  const safeUrl = diagnosticFeedUrl(url);
  const pagination = diagnosticPagination(safeUrl);
  return pagination ? `${safeUrl} [${pagination}]` : safeUrl;
}

function diagnosticText(value: string, maximumLength = 4_096): string {
  return value.replace(/https?:\/\/[^\s<>"']+/gi, (match) => {
    const suffix = match.endsWith(")") ? ")" : "";
    const url = suffix ? match.slice(0, -1) : match;
    return diagnosticFeedUrl(url) + suffix;
  }).slice(0, maximumLength);
}

function readField(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function copyErrorDetails(value: object, error: Error): void {
  const name = readField(value, "name");
  if (typeof name === "string") {
    error.name = diagnosticText(name, 256);
  }
  const stack = readField(value, "stack");
  if (typeof stack === "string") {
    error.stack = diagnosticText(stack, 8_192);
  }
  for (const field of NETWORK_FIELDS) {
    const fieldValue = readField(value, field);
    if (typeof fieldValue === "string"
        || (typeof fieldValue === "number" && Number.isFinite(fieldValue))) {
      Object.defineProperty(error, field, {
        value: typeof fieldValue === "string" ? diagnosticText(fieldValue, 256) : fieldValue,
        configurable: true,
        enumerable: true,
      });
    }
  }
}

function copyError(
  value: unknown,
  seen: Set<object>,
  depth: number,
  budget: { remaining: number },
): Error {
  if (value === null || typeof value !== "object") {
    const message = typeof value === "string" ? value : "Unknown RSS fetch failure";
    return new Error(diagnosticText(message));
  }
  if (seen.has(value)) {
    return new Error("[circular error]");
  }
  if (depth >= MAX_ERROR_DEPTH || budget.remaining <= 0) {
    return new Error("[error depth limit]");
  }
  seen.add(value);
  budget.remaining--;

  const originalMessage = readField(value, "message");
  const message = typeof originalMessage === "string"
    ? diagnosticText(originalMessage)
    : "Unknown RSS fetch failure";
  const nestedErrors = readField(value, "errors");
  let error: Error;
  if (Array.isArray(nestedErrors)) {
    const copies = nestedErrors.slice(0, MAX_AGGREGATE_ERRORS).map((nested) => {
      return copyError(nested, seen, depth + 1, budget);
    });
    if (nestedErrors.length > MAX_AGGREGATE_ERRORS) {
      copies.push(new Error("[aggregate error limit]"));
    }
    error = new AggregateError(copies, message);
  } else {
    error = new Error(message);
  }
  copyErrorDetails(value, error);
  const cause = readField(value, "cause");
  if (cause !== undefined) {
    error.cause = copyError(cause, seen, depth + 1, budget);
  }
  seen.delete(value);
  return error;
}

/** Retain stacks and network causes while excluding arbitrary error properties. */
export function diagnosticError(error: unknown): Error {
  return copyError(error, new Set(), 0, { remaining: MAX_ERROR_NODES });
}
