import type { CreateSource } from "@oboapp/source-sdk";
import { createSourceWithDependencies } from "./hybrid.js";

export const createSource: CreateSource = () => createSourceWithDependencies();
