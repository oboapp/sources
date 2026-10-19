import { serializeDiscoveryPayload } from "@oboapp/source-sdk";
import type { SourceMetadata } from "@oboapp/source-sdk/metadata";
const serialized: string = serializeDiscoveryPayload({ hello: "world" });
const metadata: SourceMetadata = { id: "example", name: "Example", url: "https://example.com", localities: ["bg.sofia"] };
void serialized;
void metadata;
