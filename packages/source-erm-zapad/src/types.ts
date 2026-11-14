export interface PolygonVertex {
  lat: string;
  lon: string;
}

export interface IncidentPoints {
  cnt: string;
  [key: string]: string | PolygonVertex;
}

export interface RawIncident {
  ceo: string;
  lat: string;
  lon: string;
  typedist: string;
  type_event: string;
  begin_event?: string | undefined;
  end_event?: string | undefined;
  city_name?: string | undefined;
  grid_id: string;
  cities?: string | undefined;
  /** Polygon vertices describe the provider map, not customer locations. */
  points: IncidentPoints;
}

export interface Municipality {
  code: string;
  name: string;
}

export interface PinRecord {
  lat: number;
  lon: number;
  eventId: string;
  typedist: string;
  begin_event: string | undefined;
  end_event: string | undefined;
  city_name: string | undefined;
  cities: string | undefined;
}

export interface GeoJSONPointFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    eventId: string;
    cityName: string | undefined;
    eventType: string;
    startTime: string | undefined;
    endTime: string | undefined;
  };
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONPointFeature[];
}

export type Warn = (message: string) => void;
