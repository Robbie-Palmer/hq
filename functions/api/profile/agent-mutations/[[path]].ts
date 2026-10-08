import {
  proxyRecipeApiRequest,
  type RecipeApiProxyContext,
} from "../../auth/routing";

export const onRequest = (context: RecipeApiProxyContext): Promise<Response> =>
  proxyRecipeApiRequest(
    context,
    "Agent change history is available on the canonical PR preview URL only",
  );
