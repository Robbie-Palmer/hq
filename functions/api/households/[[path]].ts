import { proxyLeaf } from "../auth/routing";

export const onRequest = proxyLeaf(
  "households",
  "Households",
  "Household APIs",
);
