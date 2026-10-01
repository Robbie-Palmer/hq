"use client";

import { Download, Upload } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  hasData: boolean;
  onImport(file: File): Promise<void>;
  onExport(): void;
};

export function DataControls({ hasData, onImport, onExport }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await onImport(file);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not import the plan",
      );
    }
  }

  return (
    <div className="editor-data-controls">
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        aria-label="Choose a wedding room plan"
        className="sr-only"
        onChange={importFile}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => input.current?.click()}
      >
        <Upload size={16} /> Import plan
      </Button>
      {hasData && (
        <Button type="button" variant="outline" onClick={onExport}>
          <Download size={16} /> Export backup
        </Button>
      )}
      {error && (
        <p role="alert" className="editor-error">
          {error}
        </p>
      )}
    </div>
  );
}
