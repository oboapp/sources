# @oboapp/source-sofia-capital-of-sport

Collects the News category of Sofia Capital of Sport. The catalog links to the provider’s events page. Collection uses the News RSS feed and individual WordPress articles.

Install with `pnpm add --save-exact @oboapp/source-sofia-capital-of-sport`. Pass the named `createSource` export and browser-safe `metadata` from `@oboapp/source-sofia-capital-of-sport/metadata` to the Obo runner. The source ID is `sofia-capital-of-sport` and the supported locality is `bg.sofia`.

To read the current feed directly, save this example as `news.mjs` and run `node news.mjs` with Chromium installed as described below.

```js
import { createSource } from "@oboapp/source-sofia-capital-of-sport";

const source = createSource({ locality: "bg.sofia" });
try {
  const { items } = await source.discoverItems();
  for (const item of items) {
    const article = await source.fetchItem(item);
    console.log(article.datePublished, article.title, item.identifier);
    console.log(article.message.slice(0, 150));
  }
} finally {
  await source.close?.();
}
```

Each scan lists the current feed once, preserving the first eligible entry for each original link, including its query and fragment. The feed supplies the publication time and fallback title. Article content comes from `article.post .entry-content`. Navigation, sharing controls, headers, footers, scripts and styles are removed before conversion to Markdown. A missing body fails that item.

Use Node.js 20.3 or later with Playwright 1.61.1 Chromium installed. Chromium starts on the first detail request and serves the remaining requests in the scan. The source rejects unsuccessful HTTP responses before reading their content, closes each page and waits two seconds between detail attempts. Obo closes the browser when the scan finishes. RSS requests use the shared helper’s bounded retry policy. Obo retries missing items in future scans while they remain in the feed.

Run `pnpm check` in the source repository. [Contract tests](https://github.com/oboapp/sources/tree/main/packages/source-sofia-capital-of-sport/test) · [Release guide](https://github.com/oboapp/sources/blob/main/RELEASING.md)
