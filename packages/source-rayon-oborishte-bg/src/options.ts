export interface SourceOptions {
  /** Observe each failed RSS discovery before API recovery is attempted. */
  onRssFailure?: (error: unknown) => void | Promise<void>;
}
