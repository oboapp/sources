import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasActiveWarnings, parseWeatherPage } from "../dist/esm/parser.js";
import type { WarningLevel, WeatherPageData } from "../dist/esm/types.js";

function page(cells: string[], recommendation = "", issued = "2026-01-31 11:02:45"): string {
  return `<div>прогноза за: 01.02.2026 ${recommendation}</div>
    <div>издадена на: ${issued}</div>
    <table><tr><th>Община</th><th>Висока температура</th><th>Ниска температура</th><th>Вятър</th><th>Дъжд</th><th>Сняг и/или поледица</th></tr>
    <tr><td>Столична</td>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr></table>`;
}

function weather(overrides: Partial<WeatherPageData> = {}): WeatherPageData {
  return {
    forecastDate: "2026-02-01",
    issuedAt: "2026-01-31T11:02:45",
    recommendation: "",
    sofiaWarnings: [],
    ...overrides,
  };
}

describe("parseWeatherPage", () => {
  it("parses forecast date from page content", () => {
    const result = parseWeatherPage(page(["", "", "", "", ""]));
    assert.ok(result);
    assert.equal(result.forecastDate, "2026-02-01");
  });

  it("parses issued date from page content without adding a timezone", () => {
    const result = parseWeatherPage(page(["", "", "", "", ""]));
    assert.ok(result);
    assert.equal(result.issuedAt, "2026-01-31T11:02:45");
  });

  it("extracts recommendation text before the issued section", () => {
    const result = parseWeatherPage(page([], "Снеговалежи и образуване на снежна покривка до 10 cm."));
    assert.ok(result);
    assert.equal(result.recommendation, "Снеговалежи и образуване на снежна покривка до 10 cm.");
  });

  it("extracts warning notes from Sofia columns in provider order", () => {
    const result = parseWeatherPage(page([
      "",
      "Минимални температури от -14 до -9°С; Отрицателни максимални температури",
      "",
      "",
      "Първи сняг за сезона; Образуване на снежна покривка до 10 см; Заледяване на пътните настилки",
    ]));
    assert.ok(result);
    assert.deepEqual(result.sofiaWarnings, [
      {
        type: "low_temperature",
        level: "yellow",
        notes: ["Минимални температури от -14 до -9°С", "Отрицателни максимални температури"],
      },
      {
        type: "snow_ice",
        level: "yellow",
        notes: ["Първи сняг за сезона", "Образуване на снежна покривка до 10 см", "Заледяване на пътните настилки"],
      },
    ]);
  });

  it("returns null if forecast date is not found", () => {
    assert.equal(parseWeatherPage("<div>No forecast date here</div>"), null);
  });

  it("handles empty table cells", () => {
    const result = parseWeatherPage(page(["", "", "", "", ""]));
    assert.ok(result);
    assert.deepEqual(result.sofiaWarnings, []);
  });

  it("preserves missing table and missing Sofia row as empty warnings", () => {
    for (const html of [
      "<div>прогноза за: 1/2/2026</div>",
      "<div>прогноза за: 1-2-2026</div><table><tr><td>Пловдив</td><td>Вятър</td></tr></table>",
      "<div>прогноза за: 1.2.2026</div><table><tr><th>Столична</th></tr></table>",
    ]) {
      const result = parseWeatherPage(html);
      assert.ok(result);
      assert.equal(result.forecastDate, "2026-02-01");
      assert.deepEqual(result.sofiaWarnings, []);
    }
  });

  it("uses the current time when the issue timestamp is absent", () => {
    const before = Date.now();
    const result = parseWeatherPage("<div>прогноза за: 1.2.2026</div>");
    assert.ok(result);
    assert.ok(Date.parse(result.issuedAt) >= before);
    assert.ok(Date.parse(result.issuedAt) <= Date.now());
  });

  it("stops recommendation extraction at a table when issue metadata is absent", () => {
    const result = parseWeatherPage("<div>прогноза за: 01.02.2026 <b>Силен вятър</b></div><table><tr><td>Столична</td></tr></table>");
    assert.ok(result);
    assert.equal(result.recommendation, "Силен вятър");
  });

  const indicators: Record<Exclude<WarningLevel, "green">, string[]> = {
    red: ["red", "червен", "много опасно", "_r.", "level4", "danger4"],
    orange: ["orange", "оранжев", "опасно", "_o.", "level3", "danger3"],
    yellow: ["yellow", "жълт", "потенциално", "_y.", "level2", "danger2"],
  };
  for (const [level, markers] of Object.entries(indicators)) {
    for (const marker of markers) {
      it(`recognizes the legacy ${level} indicator ${marker}`, () => {
        const result = parseWeatherPage(page(["", "", `<span class="${marker}">Вятър</span>`, "", ""]));
        assert.ok(result);
        assert.deepEqual(result.sofiaWarnings, [{ type: "wind", level, notes: ["Вятър"] }]);
      });
    }
  }

  it("retains an explicit warning level even when the cell has no notes", () => {
    const result = parseWeatherPage(page(["", "", '<img src="wind_r.png">', "", ""]));
    assert.ok(result);
    assert.deepEqual(result.sofiaWarnings, [{ type: "wind", level: "red", notes: [] }]);
  });

  it("ignores empty semicolon-separated notes and columns after the first five", () => {
    const result = parseWeatherPage(page(["", "", " ; Вятър; ; Дъжд; ", "", "", "Ignored"]));
    assert.ok(result);
    assert.deepEqual(result.sofiaWarnings, [{ type: "wind", level: "yellow", notes: ["Вятър", "Дъжд"] }]);
  });
});

describe("hasActiveWarnings", () => {
  it("returns true when recommendation text exists", () => {
    assert.equal(hasActiveWarnings(weather({ recommendation: "Снеговалежи и образуване на снежна покривка до 10 cm." })), true);
  });

  it("returns true when warnings have notes", () => {
    assert.equal(hasActiveWarnings(weather({
      sofiaWarnings: [{ type: "snow_ice", level: "yellow", notes: ["Образуване на снежна покривка до 10 см"] }],
    })), true);
  });

  it("returns true when warnings have non-green level", () => {
    assert.equal(hasActiveWarnings(weather({
      sofiaWarnings: [{ type: "wind", level: "orange", notes: [] }],
    })), true);
  });

  it("returns false when no recommendation and no warnings", () => {
    assert.equal(hasActiveWarnings(weather()), false);
  });

  for (const recommendation of [
    "Няма опасност",
    "За София няма опасност от опасно време.",
    "Без опасност",
    "Не се очаква опасност от силни ветрове.",
  ]) {
    it(`ignores the no-danger recommendation: ${recommendation}`, () => {
      assert.equal(hasActiveWarnings(weather({ recommendation })), false);
    });
  }

  it("returns true when there are warnings even if recommendation says no danger", () => {
    assert.equal(hasActiveWarnings(weather({
      recommendation: "Няма опасност",
      sofiaWarnings: [{ type: "wind", level: "yellow", notes: ["Силен вятър"] }],
    })), true);
  });

  it("returns false when only green warnings exist with no-danger recommendation", () => {
    assert.equal(hasActiveWarnings(weather({
      recommendation: "Няма опасност",
      sofiaWarnings: [{ type: "wind", level: "green", notes: [] }],
    })), false);
  });
});
