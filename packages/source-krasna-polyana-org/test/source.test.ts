import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createSource } from "../dist/esm/index.js";
import { metadata } from "../dist/esm/metadata.js";

const identifier = "https://krasnapolyana.bg/notifications/%d0%95%d1%81/";
const row = {
  link: identifier,
  date_gmt: "2026-10-09T06:48:04",
  title: { rendered: "Есенно почистване &amp; ремонти" },
  content: { protected: false, rendered: "<h2>Район</h2><p>График</p><script>omit()</script>" },
};

test("reads the six recent WordPress notices once and preserves literal links and UTC dates", async (t) => {
  const controller = new AbortController();
  const request = t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
    assert.equal(url.pathname, "/wp-json/wp/v2/notifications");
    assert.equal(url.searchParams.get("per_page"), "6");
    assert.equal(url.searchParams.get("after"), "2026-07-02T23:59:59");
    assert.equal(url.searchParams.get("order"), "desc");
    assert.ok(options.signal);
    return Response.json([row, { ...row, title: { rendered: "Later duplicate" } }]);
  });
  const source = await createSource({ locality: "bg.sofia", signal: controller.signal });
  const page = await source.discoverItems();
  assert.deepEqual(page, { items: [{ identifier }] });
  assert.deepEqual(await source.fetchItem({ identifier }), {
    title: "Есенно почистване & ремонти",
    message: "## Район\n\nГрафик",
    datePublished: "2026-10-09T06:48:04.000Z",
  });
  assert.equal(request.mock.callCount(), 1);
  await source.close?.();
  await assert.rejects(source.fetchItem({ identifier }), /not discovered/);
});

test("rejects incomplete details per notice and can recover on the next scan", async (t) => {
  const malformed = [
    { date_gmt: null }, { date_gmt: "2026-02-30T00:00:00" },
    { title: null }, { title: { rendered: " " } }, { content: { rendered: "hidden", protected: true } },
    { content: { rendered: "<script>skip()</script>" } },
  ];
  const rows = malformed.map((fields, i) => ({
    ...row, ...fields, link: `https://krasnapolyana.bg/notifications/${i}/`,
  }));
  const request = t.mock.method(globalThis, "fetch", async () => Response.json([...rows, row]));
  const source = await createSource({ locality: "bg.sofia" });
  const page = await source.discoverItems();
  for (const item of page.items.slice(0, -1)) {
    await assert.rejects(source.fetchItem(item));
  }
  assert.equal((await source.fetchItem({ identifier })).datePublished, "2026-10-09T06:48:04.000Z");
  request.mock.mockImplementation(async () => Response.json([{ ...row, link: rows[0]!.link }]));
  const retry = await source.discoverItems();
  assert.equal((await source.fetchItem(retry.items[0]!)).title, "Есенно почистване & ремонти");
  await assert.rejects(source.fetchItem({ identifier }), /not discovered/);
});

test("propagates HTTP and schema errors and accepts an empty listing", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  const source = await createSource({ locality: "bg.sofia" });
  await assert.rejects(source.discoverItems(), /HTTP 503/);
  request.mock.mockImplementation(async () => Response.json({}));
  await assert.rejects(source.discoverItems(), TypeError);
  for (const invalid of [[null], [{ link: "/relative" }], [{ link: "https://old.krasnapolyana.bg/home/latest-news/343-2026-05-28-14-41-39" }]]) {
    request.mock.mockImplementation(async () => Response.json(invalid));
    await assert.rejects(source.discoverItems());
  }
  request.mock.mockImplementation(async () => Response.json([]));
  assert.deepEqual(await source.discoverItems(), { items: [] });
});

test("exports independent catalog metadata and both module formats", () => {
  const require = createRequire(import.meta.url);
  assert.deepEqual(require("@oboapp/source-krasna-polyana-org/metadata").metadata, metadata);
  assert.equal(metadata.id, "krasna-polyana-org");
  assert.deepEqual(metadata.localities, ["bg.sofia"]);
  assert.equal(typeof require("@oboapp/source-krasna-polyana-org").createSource, "function");
});
