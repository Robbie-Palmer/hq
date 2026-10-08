import { proxyLeaf } from "../auth/routing";

export const onRequest = proxyLeaf("recipe-import-batches", "Recipe import batches", "Recipe import batches");
