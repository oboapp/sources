import type { DataSource, SourceContext } from "@oboapp/source-sdk";
import { fetchFeedXml, parseRssFeedItems } from "@oboapp/source-web-utils/rss";
import { chromium, type Browser } from "playwright";
import TurndownService from "turndown";

const newsFeed = "https://sofia2018.bg/category/%d0%bd%d0%be%d0%b2%d0%b8%d0%bd%d0%b8/feed/";

interface Dependencies {
  launchBrowser: () => Promise<Browser>;
  delay: () => Promise<void>;
}

const defaults: Dependencies = {
  launchBrowser() {
    return chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  },
  delay() {
    return new Promise((resolve) => {
      setTimeout(resolve, 2_000);
    });
  },
};

export function createSource(_context: SourceContext, dependencies: Dependencies = defaults): DataSource {
  const listed = new Map<string, { title: string; date: string }>();
  const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  let browser: Browser | undefined;
  return {
    async discoverItems() {
      listed.clear();
      const items = parseRssFeedItems(await fetchFeedXml(newsFeed), { hostname: "sofia2018.bg" });
      for (const item of items) {
        if (!listed.has(item.url)) {
          listed.set(item.url, { title: item.title, date: item.date });
        }
      }
      return { items: Array.from(listed.keys(), (identifier) => ({ identifier })) };
    },
    async fetchItem({ identifier }) {
      const item = listed.get(identifier);
      if (!item) {
        throw new Error("Sport article is absent from the current feed");
      }
      browser ??= await dependencies.launchBrowser();
      const page = await browser.newPage();
      try {
        await page.route("**/*", async (route) => {
          if (["image", "media", "font"].includes(route.request().resourceType())) {
            await route.abort();
          } else {
            await route.continue();
          }
        });
        const response = await page.goto(identifier, { waitUntil: "domcontentloaded" });
        if (response && !response.ok()) {
          throw new Error(`HTTP ${response.status()} while loading ${identifier}`);
        }
        const content = await page.evaluate(() => {
          const title = document.querySelector(".entry-header h1, h1")?.textContent?.trim() ?? "";
          const body = document.querySelector("article.post .entry-content")?.cloneNode(true);
          if (!(body instanceof HTMLElement)) {
            return { title, html: "" };
          }
          for (const node of Array.from(body.querySelectorAll(
            "script,style,nav,header,footer,.sharedaddy,.share-buttons,.post-navigation",
          ))) {
            node.remove();
          }
          return { title, html: body.innerHTML };
        });
        if (!content.html) {
          throw new Error(`Missing article content at ${identifier}`);
        }
        return { title: content.title || item.title, datePublished: item.date, message: markdown.turndown(content.html) };
      } finally {
        try {
          await page.close();
        } finally {
          await dependencies.delay();
        }
      }
    },
    async close() {
      const session = browser;
      browser = undefined;
      listed.clear();
      await session?.close();
    },
  };
}
