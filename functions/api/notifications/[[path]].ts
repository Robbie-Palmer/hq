import { proxyLeaf } from "../auth/routing";

export const onRequest = proxyLeaf(
  "notifications",
  "Notifications",
  "Notification APIs",
);
