import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SourceContent } from "@oboapp/source-sdk";
import { buildContent, getFeatureUrl } from "../dist/esm/content.js";
import type { ArcGisFeature, LayerConfig } from "../dist/esm/types.js";

interface LegacyCase {
  name: string;
  feature: ArcGisFeature;
  layer: LayerConfig;
  identifier: string | null;
  content: SourceContent | null;
}

const fixtures: LegacyCase[] = JSON.parse(readFileSync(
  new URL("./fixtures/legacy-content.json", import.meta.url),
  "utf8",
));

for (const fixture of fixtures) {
  test(`preserves captured legacy content: ${fixture.name}`, () => {
    assert.deepEqual(buildContent(fixture.feature, fixture.layer), fixture.content);
    if (fixture.identifier !== null) {
      const objectId = fixture.feature.attributes?.OBJECTID;
      assert.equal(typeof objectId, "number");
      assert.equal(getFeatureUrl(fixture.layer.id, objectId ?? 0), fixture.identifier);
    }
  });
}
