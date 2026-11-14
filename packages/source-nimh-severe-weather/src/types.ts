export type WarningLevel = "green" | "yellow" | "orange" | "red";

export type WarningType =
  | "high_temperature"
  | "low_temperature"
  | "wind"
  | "rain"
  | "snow_ice";

export interface WarningCell {
  type: WarningType;
  level: WarningLevel;
  notes: string[];
}

export interface WeatherPageData {
  forecastDate: string;
  issuedAt: string;
  recommendation: string;
  sofiaWarnings: WarningCell[];
}
