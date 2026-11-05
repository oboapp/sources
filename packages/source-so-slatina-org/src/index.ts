import type { CreateSource } from "@oboapp/source-sdk";
import { createHybridSource } from "./hybrid.js";

export const createSource: CreateSource = () => createHybridSource();
