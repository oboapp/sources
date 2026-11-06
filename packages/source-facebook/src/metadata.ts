import type { SourceMetadata } from "@oboapp/source-sdk/metadata";

export interface FacebookMetadataOptions {
  readonly id: string;
  readonly name: string;
  readonly pageId: string;
  readonly localities: readonly string[];
  readonly url?: string;
  readonly experimental?: boolean;
  readonly emergent?: boolean;
}

/** Build catalog data without loading the collector or accessing credentials. */
export function createFacebookMetadata(options: FacebookMetadataOptions): SourceMetadata {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.id) ||
      !options.name.trim() || !/^[1-9]\d{0,31}$/.test(options.pageId) ||
      options.localities.length === 0 || options.localities.some((locality) => !locality.trim())) {
    throw new Error("Invalid Facebook source metadata");
  }
  const pageUrl = options.url ?? `https://www.facebook.com/${options.pageId}`;
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    throw new Error("Invalid Facebook Page URL");
  }
  if (url.protocol !== "https:" || url.username || url.password ||
      !(url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com")) ||
      [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()]
        .some((key) => /token|secret|authorization/i.test(key))) {
    throw new Error("Invalid Facebook Page URL");
  }

  return Object.freeze({
    id: options.id,
    name: options.name,
    url: pageUrl,
    localities: Object.freeze([...options.localities]),
    ...(options.experimental === undefined ? {} : { experimental: options.experimental }),
    ...(options.emergent === undefined ? {} : { emergent: options.emergent }),
  });
}
