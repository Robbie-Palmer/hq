import { proxyLeaf } from "../auth/routing";

export const onRequest = proxyLeaf("pantry", "Pantry", "Pantry APIs");
