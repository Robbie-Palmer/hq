import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { RecipeClientStateProvider } from "@/components/recipes/recipe-client-state-provider";
import { useRecipeSelector } from "@/hooks/use-cooking-timers";
import { selectCookingTimers } from "@/lib/cooking/cookingTimersSlice";
import { recipeSessionSlice } from "@/lib/cooking/recipeClientStore";
import { createTestRecipeClientStore } from "@/tests/support/recipe-client-state";

describe("RecipeClientStateProvider", () => {
  it("does not rerender a timer subscriber when another slice changes", () => {
    const bundle = createTestRecipeClientStore();
    const renders = vi.fn();

    function TimerSubscriber() {
      const timers = useRecipeSelector(selectCookingTimers);
      const firstTimers = useRef(timers);
      expect(timers).toBe(firstTimers.current);
      renders();
      return null;
    }

    render(
      <RecipeClientStateProvider bundle={bundle}>
        <TimerSubscriber />
      </RecipeClientStateProvider>,
    );
    expect(renders).toHaveBeenCalledOnce();

    act(() => {
      bundle.store.dispatch(
        recipeSessionSlice.actions.ownerChanged({ userId: "user-1" }),
      );
    });

    expect(bundle.store.getState().recipeSession.userId).toBe("user-1");
    expect(renders).toHaveBeenCalledOnce();
  });
});
