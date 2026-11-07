import type { CreateSource, DataSource } from "@oboapp/source-sdk";
import { createHybridSource, type HybridDependencies } from "@oboapp/source-web-utils";
import { discoverRecentItems, type DiscoveryDependencies } from "./discovery.js";

export function createSourceWithDependencies(
  browserDependencies?: HybridDependencies,
  discoveryDependencies: Partial<DiscoveryDependencies> = {},
): DataSource {
  return createHybridSource({
    discoverItems: () => discoverRecentItems(discoveryDependencies),
    selectors: {
      TITLE: "h1.single-post-title",
      CONTENT: ".single-blog-content.entry",
    },
    unwantedElements: ["script", "style"],
  }, browserDependencies);
}

export const createSource: CreateSource = () => createSourceWithDependencies();
