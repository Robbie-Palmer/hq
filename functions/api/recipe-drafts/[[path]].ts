import { proxyLeaf } from "../auth/routing";

export const onRequest = proxyLeaf(
  "recipe-drafts",
  "Recipe drafts",
  "Recipe draft APIs",
);
