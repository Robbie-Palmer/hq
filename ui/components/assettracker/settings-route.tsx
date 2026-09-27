"use client";

import { DataControls } from "./data-controls";

export function SettingsRoute() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-4xl font-bold">Settings</h1>
        <p className="text-lg text-muted-foreground">
          Manage household assumptions and locally stored data.
        </p>
      </div>
      <DataControls mode="settings" />
    </div>
  );
}
