import { PostHogServerProvider } from "@posthog/openfeature-node-provider";
import { PostHog } from "posthog-node";

const posthog = new PostHog("phc_contract_fixture", { disabled: true });
const provider = new PostHogServerProvider(posthog, {
  sendFeatureFlagEvents: true,
});

export default {
  fetch(): Response {
    return Response.json({
      provider: provider.metadata.name,
      sdk: posthog.getLibraryId(),
    });
  },
};
