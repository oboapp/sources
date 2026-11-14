import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildContentHash,
  buildMarkdownText,
  buildMessageText,
  buildTimespan,
  buildTitle,
  buildUrl,
  getMaxWarningLevel,
} from "../dist/esm/builders.js";
import type { WeatherPageData } from "../dist/esm/types.js";

function weather(overrides: Partial<WeatherPageData> = {}): WeatherPageData {
  return {
    forecastDate: "2026-02-01",
    issuedAt: "2026-01-31T11:02:45",
    recommendation: "",
    sofiaWarnings: [],
    ...overrides,
  };
}

describe("buildContentHash", () => {
  it("generates a stable 12-character hash from structured content", () => {
    const data = weather({ recommendation: "Снеговалежи" });
    assert.equal(buildContentHash(data), buildContentHash(data));
    assert.match(buildContentHash(data), /^[a-f0-9]{12}$/);
  });

  it("keeps the hash stable when only recommendation or issue time changes", () => {
    assert.equal(
      buildContentHash(weather({ recommendation: "Жълт код за сняг" })),
      buildContentHash(weather({ recommendation: "Оранжев код за сняг", issuedAt: "2026-01-31T16:00:00" })),
    );
  });

  it("changes the hash when structured warning data changes", () => {
    const first = weather({ sofiaWarnings: [{ type: "snow_ice", level: "yellow", notes: ["Сняг до 5 см"] }] });
    const second = weather({ sofiaWarnings: [{ type: "snow_ice", level: "orange", notes: ["Сняг до 15 см"] }] });
    assert.notEqual(buildContentHash(first), buildContentHash(second));
  });

  it("sorts warning records by type, level and joined notes before hashing", () => {
    const data = weather({
      sofiaWarnings: [
        { type: "wind", level: "yellow", notes: ["B"] },
        { type: "rain", level: "red", notes: ["A"] },
        { type: "wind", level: "orange", notes: ["C"] },
        { type: "wind", level: "yellow", notes: ["A"] },
      ],
    });
    assert.equal(buildContentHash(data), buildContentHash({ ...data, sofiaWarnings: [...data.sofiaWarnings].reverse() }));
  });

  it("preserves note order within a warning as an identity boundary", () => {
    const data = weather({ sofiaWarnings: [{ type: "wind", level: "yellow", notes: ["A", "B"] }] });
    assert.notEqual(buildContentHash(data), buildContentHash({
      ...data,
      sofiaWarnings: [{ type: "wind", level: "yellow", notes: ["B", "A"] }],
    }));
  });
});

describe("buildUrl", () => {
  it("builds the historical URL with forecast date and content hash", () => {
    assert.match(buildUrl(weather()), /^https:\/\/weather\.bg\/obshtini\/index\.php\?z=u&o=SOF&date=2026-02-01&h=[a-f0-9]{12}$/);
  });

  it("keeps the URL stable when only recommendation text changes", () => {
    assert.equal(buildUrl(weather({ recommendation: "Yellow warning" })), buildUrl(weather({ recommendation: "Orange warning" })));
  });

  it("retains the independently frozen legacy synthetic identifier", () => {
    assert.equal(buildUrl(weather({
      forecastDate: "2026-10-04",
      recommendation: "Силен вятър",
      sofiaWarnings: [{ type: "wind", level: "yellow", notes: ["Силен вятър"] }],
    })), "https://weather.bg/obshtini/index.php?z=u&o=SOF&date=2026-10-04&h=c9d1456eab46");
  });

  it("changes the URL when the forecast date changes", () => {
    assert.notEqual(buildUrl(weather()), buildUrl(weather({ forecastDate: "2026-02-02" })));
  });
});

describe("buildTitle", () => {
  it("builds the Bulgarian title with its legacy date formatting", () => {
    assert.equal(buildTitle(weather()), "Предупреждение за опасно време - 1 февруари 2026");
  });
});

describe("buildMarkdownText", () => {
  it("includes the warning level per type and recommendation", () => {
    const markdown = buildMarkdownText(weather({
      recommendation: "Снеговалежи и образуване на снежна покривка",
      sofiaWarnings: [{ type: "snow_ice", level: "yellow", notes: ["Сняг до 10 см"] }],
    }));
    assert.match(markdown, /\*\*Жълт код за опасно време за 01\.02\.2026 \(неделя\)\*\*/);
    assert.match(markdown, /\*\*Жълт код за сняг\*\*/);
    assert.ok(markdown.includes("Снеговалежи и образуване на снежна покривка"));
  });

  it("organizes warnings by severity with the most severe first", () => {
    const markdown = buildMarkdownText(weather({
      sofiaWarnings: [
        { type: "low_temperature", level: "yellow", notes: ["Минимални температури от -14 до -9°С", "Отрицателни максимални температури"] },
        { type: "snow_ice", level: "orange", notes: ["Образуване на снежна покривка до 10 см"] },
      ],
    }));
    assert.match(markdown, /^\*\*Оранжев код за опасно време за 01\.02\.2026 \(неделя\)\*\*/);
    assert.ok(markdown.includes("**Жълт код за температура**"));
    assert.ok(markdown.includes("- Минимални температури от -14 до -9°С"));
    assert.ok(markdown.includes("- Отрицателни максимални температури"));
    assert.ok(markdown.includes("- Образуване на снежна покривка до 10 см"));
    assert.ok(markdown.indexOf("Оранжев код за сняг") < markdown.indexOf("Жълт код за температура"));
  });

  it("filters out green warnings", () => {
    const markdown = buildMarkdownText(weather({
      sofiaWarnings: [
        { type: "wind", level: "green", notes: [] },
        { type: "snow_ice", level: "yellow", notes: ["Сняг"] },
      ],
    }));
    assert.ok(!markdown.includes("Зелен"));
    assert.ok(markdown.includes("**Жълт код за сняг**"));
  });

  it("supports a severe warning without notes and all five warning labels", () => {
    const markdown = buildMarkdownText(weather({
      sofiaWarnings: [
        { type: "high_temperature", level: "red", notes: [] },
        { type: "low_temperature", level: "orange", notes: [] },
        { type: "wind", level: "yellow", notes: [] },
        { type: "rain", level: "yellow", notes: [] },
        { type: "snow_ice", level: "yellow", notes: [] },
      ],
    }));
    assert.match(markdown, /^\*\*Червен код за опасно време/);
    for (const label of ["Червен код за температура", "Оранжев код за температура", "Жълт код за вятър", "Жълт код за дъжд", "Жълт код за сняг"]) {
      assert.ok(markdown.includes(`**${label}**`));
    }
  });

  it("returns recommendation-only content when structured warnings are absent", () => {
    assert.equal(buildMarkdownText(weather({ recommendation: "Силен вятър" })), "Силен вятър");
    assert.equal(buildMarkdownText(weather()), "");
  });
});

describe("buildMessageText", () => {
  it("builds plain text with date, recommendation and joined notes", () => {
    assert.equal(buildMessageText(weather({
      recommendation: "Снеговалежи",
      sofiaWarnings: [{ type: "snow_ice", level: "yellow", notes: ["Образуване на снежна покривка", "Заледяване"] }],
    })), "Жълт код за опасно време за 01.02.2026 (неделя)\n\nСнеговалежи\n\nОбразуване на снежна покривка; Заледяване");
  });

  it("returns recommendation-only or empty content without active warnings", () => {
    assert.equal(buildMessageText(weather({ recommendation: "Силен вятър" })), "Силен вятър");
    assert.equal(buildMessageText(weather()), "");
  });

  it("omits empty recommendation and notes while retaining a warning heading", () => {
    assert.equal(buildMessageText(weather({
      sofiaWarnings: [{ type: "wind", level: "orange", notes: [] }],
    })), "Оранжев код за опасно време за 01.02.2026 (неделя)");
  });
});

describe("buildTimespan", () => {
  for (const forecastDate of ["2026-02-01", "2026-07-01"]) {
    it(`preserves the fixed +02:00 full-day bounds for ${forecastDate}`, () => {
      const { start, end } = buildTimespan(forecastDate);
      const previousDay = forecastDate === "2026-02-01" ? "2026-01-31" : "2026-06-30";
      assert.equal(start.toISOString(), `${previousDay}T22:00:00.000Z`);
      assert.equal(end.toISOString(), `${forecastDate}T21:59:59.000Z`);
    });
  }
});

describe("getMaxWarningLevel", () => {
  it("returns red when any warning is red", () => {
    assert.equal(getMaxWarningLevel([
      { type: "wind", level: "yellow", notes: [] },
      { type: "snow_ice", level: "red", notes: [] },
    ]), "red");
  });

  it("returns orange when it is the highest severity", () => {
    assert.equal(getMaxWarningLevel([
      { type: "wind", level: "yellow", notes: [] },
      { type: "snow_ice", level: "orange", notes: [] },
    ]), "orange");
  });

  it("returns green for empty warnings", () => {
    assert.equal(getMaxWarningLevel([]), "green");
  });
});
