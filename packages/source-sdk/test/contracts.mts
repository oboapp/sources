import type { CreateSource, DataSource, SourceContent } from "@oboapp/source-sdk";
import type { SourceMetadata } from "@oboapp/source-sdk/metadata";

const metadata: SourceMetadata = { id: "toplo-bg", name: "Топлофикация", url: "https://toplo.bg", localities: ["bg.sofia"], emergent: true };
const content: SourceContent = { title: "Авария", message: "Без топла вода", datePublished: "2026-10-19T00:00:00Z", deepLinkUrl: "" };
const createSource: CreateSource = ({ locality }) => {
  if (!metadata.localities.includes(locality)) throw new Error("Unsupported locality");
  return {
    async discoverItems(cursor) { return { items: [{ identifier: "https://toplo.bg/incidents/1", payload: { title: content.title } }], ...(cursor ? { nextCursor: cursor } : {}) }; },
    async fetchItem() { return content; },
    async close() {},
  } satisfies DataSource;
};
void createSource;
// @ts-expect-error Platform-owned fields are not source content.
const forbidden: SourceContent = { ...content, processed: false };
void forbidden;
