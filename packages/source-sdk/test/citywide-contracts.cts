import type { SourceContent } from "@oboapp/source-sdk";

const content: SourceContent = {
  title: "Weather warning",
  message: "Strong wind",
  datePublished: "2026-11-14T00:00:00Z",
};

const cityWide: SourceContent = { ...content, cityWide: true };
const local: SourceContent = { ...content, cityWide: false };
const scope: boolean | undefined = cityWide.cityWide;

// @ts-expect-error City-wide scope must be a boolean.
const invalid: SourceContent = { ...content, cityWide: "true" };

// @ts-expect-error Source content remains readonly.
cityWide.cityWide = false;

void local;
void scope;
void invalid;
