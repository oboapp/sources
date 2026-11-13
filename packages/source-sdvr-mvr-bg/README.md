# @oboapp/source-sdvr-mvr-bg

Collects news from the Sofia Directorate of Interior (СДВР). Chromium reads the news listing and each selected article. The package preserves the `sdvr-mvr-bg` source identity, literal identifiers, Bulgarian detail dates and Markdown output.

## Install and use

```sh
pnpm add @oboapp/source-sdvr-mvr-bg
```

Pass the runtime factory and isolated metadata to Obo's scheduled source runner:

```ts
import { createSource } from "@oboapp/source-sdvr-mvr-bg";
import { metadata } from "@oboapp/source-sdvr-mvr-bg/metadata";
```

The metadata entrypoint loads without browser dependencies. Direct SDK consumers call `await createSource({ locality: "bg.sofia" })`, then `discoverItems()` and `fetchItem(item)`. Always call `await source.close?.()` in `finally`.

Obo owns historical lookups, validation, persistence, scheduling, ingestion and notifications.

## Collection behavior

The listing selects `.card` entries with a non-empty title. Its legacy URL filter decodes a copy of each URL, checks for `новини/` and requires a numeric article ID at the end, with an optional trailing slash. The original encoded URL becomes the identifier. Query strings and fragments after the numeric ID are excluded by the existing filter. Listing order and repeated identifiers are preserved; Obo performs historical lookups and skips known items.

Article metadata comes from `h1.page-title` and `.page-content__header small`. The detail date uses the existing Bulgarian month-name conversion at local midnight. Empty or invalid dates fall back to the current time. Set the host timezone to `Europe/Sofia` to match the deployment's date interpretation. The `.page-content` body becomes Markdown after scripts, styles, navigation and images are removed. Document links remain available.

One Chromium browser is reused for listing and detail requests. Navigation waits for `domcontentloaded`. Image, media and font requests are blocked. Each page closes after its attempt and requests are paced by two seconds, including failed attempts. Provider failures propagate to Obo for per-item reporting and later retry.

The runtime requires Node.js 20.3 or later and `@oboapp/source-web-utils` with Playwright 1.61.1 and its matching Chromium revision and system libraries. Keep that browser revision aligned with the deployment image.

## Tests and release

Tests protect literal encoded identifiers, numeric URL filtering, listing and detail metadata, Bulgarian dates, content cleanup, HTTP failures, retry/session cleanup and isolated ESM/CommonJS metadata. Frozen DOM contract fixtures reproduce the legacy selectors and content output without provider requests.

Run `pnpm check` from the sources repository root. Follow [the release procedure](../../RELEASING.md) for package checks, tarball inspection, publication and Obo integration.
