"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  type ForeignExchangeDecisionRecord,
  ForeignExchangeDecisionRecordSchema,
  type ForeignExchangeReconciliation,
  reconcileForeignExchangeDecision,
} from "@/app/_projects/personal-finance-app/domain/foreignExchangeDecision";
import {
  readBrowserStorageJson,
  writeBrowserStorageJson,
} from "@/lib/browser/storage";

const STORAGE_KEY = "assettracker:fx-decisions:v1";
const RecordsSchema = z.array(ForeignExchangeDecisionRecordSchema);

export function useForeignExchangeDecisions() {
  const [records, setRecords] = useState<ForeignExchangeDecisionRecord[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    const stored = readBrowserStorageJson(
      "localStorage",
      STORAGE_KEY,
      (value): value is ForeignExchangeDecisionRecord[] =>
        RecordsSchema.safeParse(value).success,
    );
    if (stored != null) setRecords(stored);
  }, []);

  const persist = useCallback((next: ForeignExchangeDecisionRecord[]) => {
    if (!writeBrowserStorageJson("localStorage", STORAGE_KEY, next)) {
      setStorageError(
        "This browser could not save the FX decision. Check that local storage is available.",
      );
      return false;
    }
    setStorageError(null);
    setRecords(next);
    return true;
  }, []);

  const save = useCallback(
    (record: ForeignExchangeDecisionRecord) => persist([...records, record]),
    [persist, records],
  );

  const reconcile = useCallback(
    (id: string, actual: ForeignExchangeReconciliation) => {
      const next = records.map((record) =>
        record.id === id
          ? reconcileForeignExchangeDecision(record, actual)
          : record,
      );
      return persist(next);
    },
    [persist, records],
  );

  return { records, storageError, save, reconcile };
}
