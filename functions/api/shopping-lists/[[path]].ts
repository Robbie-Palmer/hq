import { proxyLeaf } from "../auth/routing";

export const onRequest = proxyLeaf(
  "shopping-lists",
  "Shopping lists",
  "Shopping-list APIs",
);
