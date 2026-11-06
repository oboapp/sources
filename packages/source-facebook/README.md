# @oboapp/source-facebook

Collects published posts from an admin-authorized Facebook Page through the Graph API. Configure one source per Page with its own source ID, catalog metadata, credentials, and runtime settings. The package implements the `@oboapp/source-sdk` discovery and content contract. Obo owns scheduling, deduplication, validation, persistence, ingestion, and notifications.

The runtime requires Node.js 20.3 or later and supports ESM and CommonJS. Runtime collection uses HTTP and has no database, browser automation, AI, or notification dependencies.

## Configure Page Sources

Replace the Page ID placeholders with confirmed numeric IDs. Provide Page access tokens through your secret-management path.

```typescript
import facebook from "@oboapp/source-facebook";

const oborishte = facebook.configure({
  id: "rayon-oborishte-facebook",
  name: 'Столична община, Район "Оборище" (Facebook)',
  pageId: "<confirmed-oborishte-page-id>",
  url: "https://www.facebook.com/RaionOborishte",
  localities: ["bg.sofia"],
  apiVersion: "v25.0",
  getAccessToken: () => process.env.FACEBOOK_OBORISHTE_PAGE_TOKEN,
});

const studentski = facebook.configure({
  id: "studentski-facebook",
  name: 'Столична община, Район "Студентски" (Facebook)',
  pageId: "<confirmed-studentski-page-id>",
  localities: ["bg.sofia"],
  apiVersion: "v25.0",
  getAccessToken: () => process.env.FACEBOOK_STUDENTSKI_PAGE_TOKEN,
});

export const selectedSources = [oborishte, studentski];
```

The named `configure` export supports the same configuration. Each call returns an independent `{ metadata, createSource }` definition. Obo's existing SDK runner accepts it through `runSource(db, oborishte.metadata, oborishte.createSource)`. The wider registry migration is tracked in [oboapp/oboapp#586](https://github.com/oboapp/oboapp/issues/586). The package keeps no shared Page state between configured sources. Create a source instance per scan through `createSource`, and call `close()` in `finally`.

`getAccessToken` can return a token directly or through a promise. The getter runs lazily on the first request, and its result is cached for that source instance's scan. Configuration and metadata creation do not access credentials. A missing token produces a typed authorization failure. The public `url` is optional and defaults to `https://www.facebook.com/<pageId>`.

Keep source IDs and Page identities stable once records are stored. Use a separate Facebook source ID alongside each district's existing website source.

## Browser-Safe Catalog Metadata

Build catalog data through the separate metadata entrypoint:

```typescript
import { createFacebookMetadata } from "@oboapp/source-facebook/metadata";

export const oborishteFacebook = createFacebookMetadata({
  id: "rayon-oborishte-facebook",
  name: 'Столична община, Район "Оборище" (Facebook)',
  pageId: "<confirmed-oborishte-page-id>",
  url: "https://www.facebook.com/RaionOborishte",
  localities: ["bg.sofia"],
});
```

The metadata entrypoint accepts public catalog configuration and loads independently from runtime collection code and credentials. Keep access tokens and token getters in server configuration.

## Discovery and Content

`discoverItems(cursor?)` reads one Graph API page per call and returns Page post identifiers, available update timestamps, bounded listing payloads, and an optional next cursor. Identifiers use `facebook:<pageId>:<provider-post-id>`, independent of the returned permalink. Pagination remains within the current scan. The adapter uses the configured endpoint and opaque cursor, and sends the access token in an authorization header.

`fetchItem(item)` reads the discovered listing payload to produce `SourceContent`. If discovery omitted an oversized payload, it fetches the same post by its provider ID. The content preserves the full original post text and supplies the API permalink as `deepLinkUrl`. Credential parameters are removed from public URLs. Publication and update timestamps are normalized to UTC and retain their separate meanings; update time is available through discovery's `observedAt`. The title uses the first nonempty line, limited to 180 characters. Obo supplies source ID, locality, crawl time, and processing state when it stores the raw source document.

Set `lookbackDays` to an integer from `0` to `30` to change the seven-day default; `0` disables the publication-time filter. Each discovery call still returns one page. Set `pageSize` to an integer from `1` to `100` to change the default request of 25 posts per page. Requests have a 15-second timeout and up to two retries for rate limits or server errors. A `Retry-After` longer than five seconds raises a typed error so the caller can retry later. Select an explicit Graph API version for each source. Follow current Meta permissions, Page task, app mode, App Review, and verification requirements for the Page and app setup.

Discovery payloads follow the SDK's 256 KiB JSON limit. Oversized payloads are omitted from the discovery item so `fetchItem` can refetch the post. Original text is never truncated to fit that limit. Malformed payloads raise `FacebookContentError` with code `invalid_payload`. Failed items remain eligible for another scan through Obo's normal runner behavior.

## Media and Manual Review

Text and link posts provide content for ingestion when publication time and a public Facebook permalink are valid. Posts with text remain usable when they also contain photos, videos, or incomplete attachment metadata. Discovery payloads retain attachment metadata and `reviewReasons` so callers can assess media coverage.

`fetchItem` raises the typed `FacebookContentError` when required text, publication time, or permalink is missing or invalid. Its `code` identifies the failure, and its optional `post` contains metadata and attachment references for a review report. The error's `post` excludes the original message. Image-only and video-only notices require another method to extract their text before ingestion.

The adapter retains useful public attachment references and metadata. Credentials, raw paging URLs, and signed CDN image URLs must stay outside logs, fixtures, and shared reports. Review original text before sharing it or sending it to another processor.

Obo's runner skips already stored identifiers. A provider update timestamp does not refresh an existing post or apply an edit, cancellation, or deletion to stored messages. Track revisions separately during a pilot and decide how corrections will be handled before production rollout.

## Authorization and Pilot Readiness

Fixture tests cover the reusable adapter contract. Admin authorization, live access, token renewal/reconnection, revocation, and permitted storage, display, and external AI processing must be confirmed for the selected app and Page before unattended collection.

For [Obo's Oborishte pilot](https://github.com/oboapp/oboapp/issues/662), keep Facebook and website records in an isolated pilot environment. Verify every configured database backend and make production notification delivery unavailable before running real ingestion. This package can be reviewed and released before the admins join the pilot.

Public post text, public links, and publication dates supplied by maintainers can improve representative fixtures. Use synthetic credentials and remove personal information, raw paging URLs, and signed media URLs from fixtures.

## Checks and Release

Run `pnpm install --frozen-lockfile` and `pnpm check` at the repository root. Pack and inspect the affected package using the canonical [release procedure](../../RELEASING.md). Publication and a configured Obo integration follow that procedure as separate steps. Consumers pin the published package version and run their source-to-ingestion checks before enabling a Page source.
