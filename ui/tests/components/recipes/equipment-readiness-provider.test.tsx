import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EquipmentReadinessProvider,
  useEquipmentReadiness,
} from "@/components/recipes/equipment-readiness-provider";

const mocks = vi.hoisted(() => ({
  getHouseholdEquipment: vi.fn(),
  getHouseholds: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: mocks.useSession },
}));

vi.mock("@/lib/api/households", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/households")>()),
  getHouseholdEquipment: mocks.getHouseholdEquipment,
  getHouseholds: mocks.getHouseholds,
}));

function Probe() {
  const { equipment, error, loading, matchRecipe } = useEquipmentReadiness();
  const match = matchRecipe({ cookware: ["frying pan", "slow cooker"] });
  return (
    <output>
      {JSON.stringify({
        active: equipment.active,
        error,
        loading,
        mode: equipment.mode,
        missing: match.missingEquipment.map((item) => item.slug),
      })}
    </output>
  );
}

function renderProvider(children: ReactNode = <Probe />) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EquipmentReadinessProvider>{children}</EquipmentReadinessProvider>
    </QueryClientProvider>,
  );
}

describe("EquipmentReadinessProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({ data: null, isPending: false });
    mocks.getHouseholds.mockResolvedValue([]);
  });

  it("keeps signed-out visitors on the unrestricted fallback", () => {
    renderProvider();

    expect(screen.getByText(/"active":false/)).toHaveTextContent(
      '"error":false,"loading":false,"mode":"warn","missing":[]',
    );
    expect(mocks.getHouseholds).not.toHaveBeenCalled();
  });

  it("keeps users without a household on the unrestricted fallback", async () => {
    mocks.useSession.mockReturnValue({
      data: { user: { id: "user-1" } },
      isPending: false,
    });
    renderProvider();

    await waitFor(() =>
      expect(screen.getByText(/"active":false/)).toHaveTextContent(
        '"loading":false',
      ),
    );
    expect(mocks.getHouseholdEquipment).not.toHaveBeenCalled();
  });

  it("loads household equipment and matches recipe cookware", async () => {
    mocks.useSession.mockReturnValue({
      data: { user: { id: "user-1" } },
      isPending: false,
    });
    mocks.getHouseholds.mockResolvedValue([
      { id: "household-1", name: "Park Road" },
    ]);
    mocks.getHouseholdEquipment.mockResolvedValue({
      catalog: [
        { slug: "frying-pan", name: "frying pan", category: "cookware" },
        { slug: "slow-cooker", name: "slow cooker", category: "appliance" },
      ],
      owned: [{ slug: "frying-pan" }],
      recipeMatchMode: "hide",
    });
    renderProvider();

    await waitFor(() =>
      expect(screen.getByText(/"active":true/)).toHaveTextContent(
        '"error":false,"loading":false,"mode":"hide","missing":["slow-cooker"]',
      ),
    );
    expect(mocks.getHouseholdEquipment).toHaveBeenCalledWith(
      "household-1",
      expect.any(AbortSignal),
    );
  });

  it("reports loading failures without restricting recipes", async () => {
    mocks.useSession.mockReturnValue({
      data: { user: { id: "user-1" } },
      isPending: false,
    });
    mocks.getHouseholds.mockRejectedValue(new Error("offline"));
    renderProvider();

    await waitFor(() =>
      expect(screen.getByText(/"active":false/)).toHaveTextContent(
        '"error":true,"loading":false',
      ),
    );
  });
});
