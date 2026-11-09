import type { CreateSource } from "@oboapp/source-sdk";
import { createSourceWithDependencies } from "./browser.js";

export const createSource: CreateSource = () => {
  return createSourceWithDependencies();
};
