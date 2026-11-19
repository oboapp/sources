export interface Bounds {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

export interface Cell {
  readonly id: string;
  readonly bounds: Bounds;
}

// Keep the legacy grid dimensions and arithmetic. A different rounding order
// can assign a reading on a shared boundary to a different synthetic ID.
export function buildGrid(bounds: Bounds): Cell[] {
  if (!(bounds.south >= -90 && bounds.south < bounds.north && bounds.north <= 90 &&
      bounds.west >= -180 && bounds.west < bounds.east && bounds.east <= 180)) {
    throw new RangeError("Sensor.Community requires finite, ordered locality bounds");
  }
  const centerLat = (bounds.south + bounds.north) / 2;
  const kmPerDegreeLng = 111 * Math.cos((centerLat * Math.PI) / 180);
  const rows = Math.ceil(((bounds.north - bounds.south) * 111) / 4);
  const cols = Math.ceil(((bounds.east - bounds.west) * kmPerDegreeLng) / 4);
  const latStep = (bounds.north - bounds.south) / rows;
  const lngStep = (bounds.east - bounds.west) / cols;
  const cells: Cell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({
        id: `r${row}c${col}`,
        bounds: {
          south: bounds.south + row * latStep,
          north: bounds.south + (row + 1) * latStep,
          west: bounds.west + col * lngStep,
          east: bounds.west + (col + 1) * lngStep,
        },
      });
    }
  }
  return cells;
}

export function contains({ bounds }: Cell, lat: number, lng: number): boolean {
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
}

export function cellGeometry({ west, east, south, north }: Bounds) {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
      },
    }],
  };
}
