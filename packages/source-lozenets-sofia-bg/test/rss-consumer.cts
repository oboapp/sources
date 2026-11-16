import type { CreateSource } from "@oboapp/source-sdk";
import {
  createSource,
  type RssFeedFetchEvent,
  type RssFeedFetchOptions,
} from "@oboapp/source-lozenets-sofia-bg";

const sdkFactory: CreateSource = createSource;
const options: RssFeedFetchOptions = {
  onEvent(event: RssFeedFetchEvent) {
    void event.type;
  },
};
void createSource({ locality: "bg.sofia" }, options);
void sdkFactory;
