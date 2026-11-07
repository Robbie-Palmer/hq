import {
  proxyRecipeApiRequest,
  type RecipeApiProxyContext,
} from "../../auth/routing";

export const onRequest = (context: RecipeApiProxyContext) =>
  proxyRecipeApiRequest(
    context,
    "Term review is available on the canonical PR preview URL only",
    "Term resolution",
  );
