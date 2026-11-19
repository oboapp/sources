# @oboapp/source-sensor-community

Evaluate particulate readings from the Sensor.Community network for a locality. The Obo catalog uses `sensor-community` for this experimental source in `bg.sofia`.

## Use

Install with `pnpm add --save-exact @oboapp/source-sensor-community`. The runtime requires Node 20.3 or later. Import catalog information from `@oboapp/source-sensor-community/metadata`.

```ts
import { createSource, type ReadingsInput } from "@oboapp/source-sensor-community";

function createSofiaAlerts(input: ReadingsInput) {
  return createSource({ locality: "bg.sofia" }, input);
}
```

Supply the locality's geographic bounds and a `readReadings(locality, start, end)` function. The function returns stored observations for the inclusive interval with a sensor ID, coordinates, a JavaScript Date, and numeric PM10 (`p1`) and PM2.5 (`p2`) values. Obo's separate sampling job and readings store provide this input.

## Discovery and content

Each scan reads one four-hour window. It divides the area into roughly 4 km cells, removes invalid readings and outliers, and computes a NowCast index for each two-hour half. A cell needs three distinct recent sensors and at least one reading no older than 45 minutes. An index of 5 triggers an immediate alert. An index of 4 in both halves triggers a sustained alert.

Discovery returns identifiers of the form `sensor-community://<locality>/r<row>c<column>/<timestamp>`. The timestamp is Unix time in milliseconds rounded down to a half hour. Content carries a Bulgarian alert, its evaluation timespan and the cell polygon. The public detail link is empty.

A failed readings request rejects discovery. `fetchItem` reads from the current scan's results. The next discovery or `close()` clears them. Obo checks historical identifiers and persists new alerts.

Run `pnpm check` from the repository root. [Package tests](https://github.com/oboapp/sources/tree/main/packages/source-sensor-community/test) · [Release procedure](https://github.com/oboapp/sources/blob/main/RELEASING.md)
