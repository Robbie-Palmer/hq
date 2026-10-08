import { proxyLeaf } from "../auth/routing";

export const onRequest = proxyLeaf("recipes", "Recipes", "Recipe APIs");
