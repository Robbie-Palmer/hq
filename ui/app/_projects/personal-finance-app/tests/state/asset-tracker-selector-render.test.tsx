import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { Provider } from "react-redux";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assetTrackerEvents,
  createAssetTrackerStore,
  selectAssetTrackerData,
  useAssetTrackerSelector,
} from "@/app/_projects/personal-finance-app/state/asset-tracker-store";

function AccountCountProbe() {
  const renders = useRef(0);
  renders.current += 1;
  const accountCount = useAssetTrackerSelector(
    (state) => selectAssetTrackerData(state).accounts.length,
  );
  return (
    <p>
      {accountCount} accounts, {renders.current} renders
    </p>
  );
}

describe("Asset Tracker selector subscriptions", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("does not rerender an unchanged data selection when status changes", () => {
    const store = createAssetTrackerStore();
    render(
      <Provider store={store}>
        <AccountCountProbe />
      </Provider>,
    );
    const initialText = screen.getByText(/accounts, 1 renders/).textContent;

    act(() => {
      store.dispatch(
        assetTrackerEvents.commandRejected({
          operation: "storage write rejected",
          storageFailure: true,
          message: "storage unavailable",
        }),
      );
    });

    expect(screen.getByText(initialText ?? "missing")).toBeVisible();
  });
});
