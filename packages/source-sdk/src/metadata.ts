/** Browser-safe catalog data. A source's metadata entrypoint must not import its runtime. */
export interface SourceMetadata {
  /** Existing persisted sourceType, unchanged across package versions. */
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly localities: readonly string[];
  readonly experimental?: boolean;
  readonly emergent?: boolean;
}
