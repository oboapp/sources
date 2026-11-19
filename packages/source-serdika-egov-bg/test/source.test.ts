import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createSource, parsePublicationDate } from "../dist/esm/index.js";
import { metadata } from "../dist/esm/metadata.js";

const host = "https://serdika.egov.bg";
const path = "/content/site/actual/messages/тест";
const context = "/wps/portal/serdika.egov.bg-15783";
const url = host + context + "?uri=keep%2fCase&amp;a=2#x";
const section = "actualmessages";
const article = `<div class="content-wrapper"><h2>Ремонт &amp; път</h2><div id="publish-date">
Дата на събитие: 20.04.2026 Дата на публикуване: 07.04.2026 Последна актуализация: 16.04.2026
</div><div id="body"><div><p>Начало <strong>утре</strong>.</p></div>
<script>omit()</script><nav>omit</nav></div></div>`;

function entry(link: string, contentPath = path, portalContext = context): string {
  return `<atom:entry><atom:link href="${link}" type="text/html" />
    <wplc:field id="contentpath">${contentPath}</wplc:field>
    <wplc:field id="portalcontextpath">${portalContext}</wplc:field></atom:entry>`;
}

function feed(entries = ""): Response {
  return new Response(`<atom:feed>${entries}</atom:feed>`);
}

test("preserves each historical URL spelling and requests all three sections in order", async () => {
  const sections: string[] = [];
  const source = createSource({ locality: "bg.sofia" }, {
    fetch: async (input) => {
      const listing = new URL(String(input));
      const [template, keyword] = listing.searchParams.getAll("constraint").map((value) => JSON.parse(value));
      assert.equal(template.id, "authoringtemplate");
      sections.push(keyword.values[0]);
      assert.equal(listing.searchParams.get("results"), "20");
      return feed(entry(url) + entry("?a=%2F", path, "/custom") + entry("/notice?q=1") +
        entry("", path) + entry(url, "/content/wrong"));
    },
  });
  let page = await source.discoverItems();
  assert.deepEqual(page.items.map((item) => item.identifier), [
    url.replace("&amp;", "&"), host + "/custom?a=%2F", host + "/notice?q=1",
    host + context + "?urile=" + encodeURIComponent("wcm:path:" + path),
  ]);
  page = await source.discoverItems(page.nextCursor);
  page = await source.discoverItems(page.nextCursor);
  assert.equal(page.nextCursor, undefined);
  assert.deepEqual(sections, [section, "actualnews", "actualevents"]);
  await assert.rejects(source.discoverItems("invalid"), /cursor/);
});

test("isolates failing sections, reports total failure and starts fresh on the next scan", async () => {
  let allowed = false;
  const errors: string[] = [];
  const source = createSource({ locality: "bg.sofia" }, {
    fetch: async () => allowed ? feed() : new Response(null, { status: 403 }),
    async onSectionFailure(name, error) {
      errors.push(name);
      assert.match(String(error), /403/);
      throw new Error("Reporting unavailable");
    },
  });
  const first = await source.discoverItems();
  assert.deepEqual(first, { items: [], nextCursor: "actualnews" });
  const second = await source.discoverItems(first.nextCursor);
  await assert.rejects(source.discoverItems(second.nextCursor), AggregateError);
  assert.deepEqual(errors, [section, "actualnews", "actualevents"]);
  allowed = true;
  await source.discoverItems();
  allowed = false;
  await source.discoverItems("actualnews");
  assert.deepEqual(await source.discoverItems("actualevents"), { items: [] });
});

test("retries malformed feeds and transient failures and paces details after reading the body", async () => {
  const responses = [
    () => new Response("maintenance"),
    () => new Response(null, { status: 429 }),
    () => feed(entry(url)),
    () => {
      throw Object.assign(new TypeError("network"), { cause: { code: "ECONNRESET" } });
    },
    () => new Response(article),
    () => new Response(null, { status: 404 }),
  ];
  const delays: number[] = [];
  const source = createSource({ locality: "bg.sofia" }, {
    fetch: async () => responses.shift()!(),
    delay: async (ms) => {
      delays.push(ms);
    },
  });
  const notice = (await source.discoverItems()).items[0]!;
  assert.deepEqual(await source.fetchItem(notice), {
    title: "Ремонт & път", datePublished: "2026-04-07T00:00:00.000Z", message: "Начало **утре**.",
  });
  await assert.rejects(source.fetchItem(notice), /404/);
  assert.deepEqual(delays, [1_000, 2_000, 1_000, 2_000, 2_000]);
  await assert.rejects(source.fetchItem({ identifier: "https://example.org/" }), /host/);
});

test("collects attachment-only notices and rejects incomplete detail content", async () => {
  let html = `<h2>Известие</h2><div id="publish-date">03.02.2026</div>
  <div id="body"></div><div class="card20"><img src="/files/%D0%BF.pdf?x=1&amp;y=2">
  <a href="/files/%D0%BF.pdf?x=1&amp;y=2">Повторение</a><img src="data:image/png,image"></div>`;
  const source = createSource({ locality: "bg.sofia" }, {
    fetch: async () => new Response(html),
    delay: async () => undefined,
  });
  const notice = { identifier: host + "/notice" };
  const detail = await source.fetchItem(notice);
  assert.match(detail.message, /само прикачени файлове/);
  assert.match(detail.message, /\[п.pdf\]\(https:\/\/serdika.egov.bg\/files\/%D0%BF.pdf\?x=1&y=2\)/);
  assert.equal(detail.datePublished, "2026-02-03T00:00:00.000Z");
  for (html of ["<div data-id='body'>wrong</div>", "<div id='body'></div>", "<div id='body'>Body only</div>"]) {
    await assert.rejects(source.fetchItem(notice), /Failed to extract/);
  }
});

test("uses legacy publication date precedence and a scan-time fallback", () => {
  assert.equal(parsePublicationDate("Първа 03.04.2026"), "2026-04-03T00:00:00.000Z");
  assert.equal(parsePublicationDate("07/04/26"), "2026-04-07T00:00:00.000Z");
  assert.equal(parsePublicationDate("02.01.2026 Дата на публикуване Дата на публикуване 04.05.2026"),
    "2026-05-04T00:00:00.000Z");
  const before = Date.now();
  const fallback = Date.parse(parsePublicationDate("без дата"));
  assert.ok(before <= fallback && fallback <= Date.now());
  assert.ok(Date.parse(parsePublicationDate("07/04/26/99")) >= before);
});

test("keeps literal less-than signs and discards an unfinished title tag", async () => {
  const html = '<h2>2 < 3 > 1 <b>units</b> <unfinished</h2><div id="body">Notice body</div>';
  const source = createSource({ locality: "bg.sofia" }, {
    fetch: async () => new Response(html),
    delay: async () => undefined,
  });
  const notice = await source.fetchItem({ identifier: host + "/notice" });
  assert.equal(notice.title, "2 < 3 > 1 units");
});

test("exports both module formats and literal catalog metadata", () => {
  const require = createRequire(import.meta.url);
  assert.equal(typeof require("@oboapp/source-serdika-egov-bg").createSource, "function");
  assert.deepEqual(require("@oboapp/source-serdika-egov-bg/metadata").metadata, metadata);
  assert.deepEqual(metadata, {
    id: "serdika-egov-bg", name: 'Столична община, Район "Сердика"', localities: ["bg.sofia"],
    url: host + "/wps/portal/municipality-serdika/actual/messages",
  });
});
