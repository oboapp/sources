/** PM10 (p1) and PM2.5 (p2) in micrograms per cubic metre. */
export interface Reading {
  readonly sensorId: number;
  readonly lat: number;
  readonly lng: number;
  readonly timestamp: Date;
  readonly p1: number;
  readonly p2: number;
}
