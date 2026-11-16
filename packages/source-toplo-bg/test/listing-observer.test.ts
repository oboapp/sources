import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { CreateSource, DataSource } from "@oboapp/source-sdk";
import { createSource, type ToploListingObserver } from "../dist/esm/index.js";
import { createToploSource, type ToploListingResult } from "../dist/esm/toplo.js";

const listing = readFileSync(new URL("./fixtures/legacy-listing.html", import.meta.url), "utf8");
const emptyListing = "<html><script>function parseAll() {}</script></html>";
const originalFetch = globalThis.fetch;
const require = createRequire(import.meta.url);
const commonJs: { createSource: typeof createSource } = require("../dist/cjs/index.js");

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

for (const [format, factory] of [["ESM", createSource], ["CommonJS", commonJs.createSource]] as const) {
  test(`observes the fetched listing once through the ${format} factory without another request`, async () => {
    const fetch = mock.fn<typeof globalThis.fetch>(async () => {
      return new Response(listing);
    });
    globalThis.fetch = fetch;
    const onListing = mock.fn<ToploListingObserver>(async (observation) => {
      assert.equal(observation.html, listing);
      const observedAt = Date.parse(observation.observedAt);
      assert.ok(observedAt >= before);
      assert.ok(observedAt <= Date.now());
      return { count: 1 };
    });
    const before = Date.now();
    const source = factory({ locality: "bg.sofia" }, { onListing });
    try {
      const discovery = await source.discoverItems();
      assert.equal(discovery.items.length, 1);
      await source.fetchItem(discovery.items[0]!);
      assert.equal(onListing.mock.callCount(), 1);
      assert.equal(fetch.mock.callCount(), 1);
    } finally {
      await source.close?.();
    }
  });
}

test("keeps the default SDK factory compatible and rejects an unverified empty listing", async () => {
  globalThis.fetch = async () => {
    return new Response(emptyListing);
  };
  const sdkFactory: CreateSource = createSource;
  const source = await sdkFactory({ locality: "bg.sofia" });
  try {
    await assert.rejects(source.discoverItems(), /No incidents found in HTML/);
  } finally {
    await source.close?.();
  }
});

test("accepts an empty discovery when the observer verifies zero listed incidents", async () => {
  const source = createToploSource({
    fetch: async () => {
      return new Response(emptyListing);
    },
    onListing: () => {
      return { count: 0 };
    },
  });
  try {
    assert.deepEqual(await source.discoverItems(), { items: [] });
  } finally {
    await source.close?.();
  }
});

test("rejects a claimed empty listing when parsed incidents are present and clears their cache", async () => {
  const source = createToploSource({
    fetch: async () => {
      return new Response(listing);
    },
    onListing: () => {
      return { count: 0 };
    },
  });
  try {
    await assert.rejects(source.discoverItems(), /reported zero for a nonempty listing/);
    await assert.rejects(source.fetchItem({ identifier: "https://toplo.bg/incidents/item-1" }), /Missing listing incident/);
  } finally {
    await source.close?.();
  }
});

test("allows the full listing count to exceed the geometry-filtered discovery count", async () => {
  const incidentBlock = listing.match(/var geoJsonString[\s\S]+?if \(geoJsonString\) \{ \}/)?.[0];
  assert.ok(incidentBlock);
  const invalidBlock = incidentBlock
    .replaceAll("item-1", "item-2")
    .replace("[23.32,42.7]", "[999,999]");
  const mixedListing = listing.replace("}</script>", `${invalidBlock}\n}</script>`);
  const warn = mock.fn<(message: string) => void>();
  const source = createToploSource({
    fetch: async () => {
      return new Response(mixedListing);
    },
    onListing: () => {
      return { count: 2 };
    },
    warn,
  });
  try {
    assert.equal((await source.discoverItems()).items.length, 1);
    assert.ok(warn.mock.callCount() > 0);
  } finally {
    await source.close?.();
  }
});

test("rejects a positive listing count when no incidents can be parsed", async () => {
  const source = createToploSource({
    fetch: async () => {
      return new Response(emptyListing);
    },
    onListing: () => {
      return { count: 1 };
    },
  });
  try {
    await assert.rejects(source.discoverItems(), /No incidents found in HTML/);
  } finally {
    await source.close?.();
  }
});

test("rejects missing, nonnumeric, negative, fractional and unsafe observer counts", async () => {
  const invalidResults: unknown[] = [
    undefined,
    null,
    {},
    { count: "0" },
    { count: -1 },
    { count: 1.5 },
    { count: Number.NaN },
    { count: Number.POSITIVE_INFINITY },
    { count: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const result of invalidResults) {
    const source = createToploSource({
      fetch: async () => {
        return new Response(listing);
      },
      onListing: () => {
        return result as ToploListingResult;
      },
    });
    try {
      await assert.rejects(source.discoverItems(), /nonnegative safe integer count/);
    } finally {
      await source.close?.();
    }
  }
});

test("propagates observer failures before parsing content or filling the cache", async () => {
  const failure = new Error("Incomplete listing");
  const warn = mock.fn<(message: string) => void>();
  const source = createToploSource({
    fetch: async () => {
      return new Response(listing.replace('"AccidentId":"item-1"', '"AccidentId":unquoted'));
    },
    onListing: async () => {
      throw failure;
    },
    warn,
  });
  try {
    await assert.rejects(source.discoverItems(), (error) => {
      return error === failure;
    });
    assert.equal(warn.mock.callCount(), 0);
    await assert.rejects(source.fetchItem({ identifier: "https://toplo.bg/incidents/item-1" }), /Missing listing incident/);
  } finally {
    await source.close?.();
  }
});

test("does not observe unsuccessful HTTP responses", async () => {
  const onListing = mock.fn<ToploListingObserver>(() => {
    return { count: 0 };
  });
  const source = createToploSource({
    fetch: async () => {
      return new Response("Unavailable", { status: 503 });
    },
    onListing,
  });
  try {
    await assert.rejects(source.discoverItems(), /HTTP 503/);
    assert.equal(onListing.mock.callCount(), 0);
  } finally {
    await source.close?.();
  }
});

test("stops before observation when cancellation occurs while reading the listing", async () => {
  const controller = new AbortController();
  const onListing = mock.fn<ToploListingObserver>(() => {
    return { count: 1 };
  });
  const source = createToploSource({
    fetch: async () => {
      controller.abort();
      return new Response(listing);
    },
    signal: controller.signal,
    onListing,
  });
  try {
    await assert.rejects(source.discoverItems(), { name: "AbortError" });
    assert.equal(onListing.mock.callCount(), 0);
  } finally {
    await source.close?.();
  }
});

for (const cancellation of ["external signal", "close"] as const) {
  test(`stops before parsing when the observer triggers cancellation through ${cancellation}`, async () => {
    const controller = new AbortController();
    const warn = mock.fn<(message: string) => void>();
    const source: DataSource = createToploSource({
      fetch: async () => {
        return new Response(listing.replace('"AccidentId":"item-1"', '"AccidentId":unquoted'));
      },
      signal: controller.signal,
      onListing: async () => {
        if (cancellation === "close") {
          await source.close?.();
        } else {
          controller.abort();
        }
        return { count: 1 };
      },
      warn,
    });
    try {
      await assert.rejects(source.discoverItems(), { name: "AbortError" });
      assert.equal(warn.mock.callCount(), 0);
      await assert.rejects(source.fetchItem({ identifier: "https://toplo.bg/incidents/item-1" }), /Missing listing incident/);
    } finally {
      await source.close?.();
    }
  });
}
