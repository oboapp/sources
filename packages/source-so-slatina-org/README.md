# @oboapp/source-so-slatina-org

Collects the Slatina district feed and extracts new article pages with Playwright. The source preserves the existing crawler's URL identity, RSS publication date, page title fallback, HTML cleanup, and Markdown conversion. It launches Chromium lazily and closes it at the end of a scan. The runtime requires a compatible Playwright Chromium installation. The metadata entrypoint does not load Playwright.

The package pins Playwright 1.61.1 to match the version currently resolved in the Obo deployment image. Keep the package and image versions aligned when upgrading Playwright so the installed Chromium revision is available to the source.

Pass `createSource` and `metadata` to Obo's scheduled source runner. Obo owns deduplication, storage, and scheduling.
