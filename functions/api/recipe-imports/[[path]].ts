import { proxyLeaf } from "../auth/routing";

export const onRequest = proxyLeaf(
  "recipe-imports",
  "Recipe imports",
  "Recipe imports",
);
