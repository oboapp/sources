# @oboapp/source-toplo-bg

Collects heating incidents from the HTML listing at `https://toplo.bg/accidents-and-maintenance`. The incident JSON is already embedded in the server response, so the package reads it with HTTP and parses the data without executing page JavaScript. Each discovery makes one request with a 30-second timeout and supports the SDK cancellation signal. The runtime requires Node.js 20.3 or later.

Pass `createSource` and the isolated `metadata` entrypoint to Obo's scheduled source runner. Create one instance per scan. `discoverItems` emits the exact historical synthetic identifiers, such as `https://toplo.bg/incidents/item-1`. `fetchItem` reads content from that instance's listing cache and makes no request to the synthetic URL. Discovery items have no payload, so large geometries remain available without exceeding the SDK's 256 KiB discovery payload limit. `close` clears the cache and cancels active requests.

The package preserves Bulgarian content formatting, publication dates, heating categories, empty detail links, timespan fallback rules, and precomputed geometry. It keeps the legacy handling of Point, LineString and Polygon features: fix swapped Sofia coordinates, discard invalid features, retain other valid features, and skip incidents whose features are all invalid. An empty FeatureCollection remains valid. The same Sofia bounds as the legacy validator are used to recognize swapped coordinates. Malformed incident blocks, invalid geometry and coordinate corrections emit warnings.

An optional `onListing` callback observes the same fetched HTML before content parsing. It receives `{ html, observedAt }`, where `observedAt` is an ISO timestamp recorded after the response body is read. Return `{ count }` with a nonnegative safe integer for the complete listing, including incidents without usable geometry. The callback can be synchronous or asynchronous. A failed callback fails discovery, and cancellation is checked again after it completes.

```typescript
const source = createSource(context, {
  async onListing({ html, observedAt }) {
    const count = await inspectCompleteListing(html, observedAt);
    return { count };
  },
});
```

The observer owns complete-listing validation before returning zero. A verified zero permits an empty discovery. Without an observer, or when it reports a positive count, a listing with no parsed incidents fails. A zero count that contradicts parsed incidents also fails. A positive count can exceed the geometry-filtered discovery count. Observation uses the existing response without another provider request. The package owns the request timeout and instance cache.

Dates in text use the process timezone, matching the existing crawler. Invalid or pre-2025 starts fall back to the current time for the timespan; missing or invalid ends fall back to the start. The original `datePublished` and title remain unchanged. Obo controls content validation before storage.

The frozen listing and expected content fixtures come from Obo's pre-refactor Toplo contract. Tests cover literal identity, content, geometry cleanup, large cached incidents, failure handling, cancellation, ESM/CommonJS entrypoints, listing observation and verified empty listings.

Obo owns deduplication, storage, scheduling, source ID and locality validation. Keep the existing `toplo-bg` job and emergent schedule when integrating. Publish this package through the reviewed release process in the repository's `RELEASING.md`, then install the exact npm version in a separate Obo integration PR. Roll back the integration by restoring the previous crawler entrypoint and redeploying; stored identifiers stay compatible.
