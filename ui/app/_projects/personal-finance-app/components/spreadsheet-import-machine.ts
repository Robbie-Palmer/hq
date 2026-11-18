import { and, assign, fromCallback, type InspectionEvent, setup } from "xstate";
import {
  type CapitalFlowKind,
  type ContributionHistoryFormat,
  type Ownership,
  type PastedHistoryResult,
  parsePastedHistory,
} from "@/app/_projects/personal-finance-app/domain";

export const MAX_SPREADSHEET_FILE_BYTES = 1_000_000;

const FILE_NAME_PATTERN = /\.(csv|tsv)$/i;

export interface SpreadsheetImportFile {
  readonly name: string;
  readonly size: number;
  text(signal?: AbortSignal): Promise<string>;
}

export interface SpreadsheetFileReview {
  readonly fileName: string;
  readonly result: PastedHistoryResult;
}

export type SpreadsheetImportRequest =
  | {
      readonly kind: "balances";
      readonly accountId: string;
      readonly ownership: Ownership;
      readonly rows: PastedHistoryResult["rows"];
    }
  | {
      readonly kind: "capitalFlows";
      readonly accountId: string;
      readonly capitalKind: CapitalFlowKind;
      readonly contributionFormat: ContributionHistoryFormat;
      readonly ownership: Ownership;
      readonly rows: PastedHistoryResult["rows"];
    }
  | {
      readonly kind: "income";
      readonly ownership: Ownership;
      readonly rows: PastedHistoryResult["rows"];
    };

interface SpreadsheetImportContext {
  error: string | null;
  file: SpreadsheetImportFile | null;
  review: SpreadsheetFileReview | null;
  submission: SpreadsheetImportRequest | null;
}

export type SpreadsheetImportEvent =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "FILE.CHOSEN"; file: SpreadsheetImportFile }
  | { type: "FILE.READ.SUCCEEDED"; review: SpreadsheetFileReview }
  | { type: "FILE.READ.FAILED" }
  | { type: "SUBMIT.REQUESTED"; request: SpreadsheetImportRequest }
  | { type: "SUBMIT.RETRY" }
  | { type: "SUBMIT.SUCCEEDED" }
  | { type: "SUBMIT.FAILED"; error: string };

type FileChosenEvent = Extract<SpreadsheetImportEvent, { type: "FILE.CHOSEN" }>;
type FileReadSucceededEvent = Extract<
  SpreadsheetImportEvent,
  { type: "FILE.READ.SUCCEEDED" }
>;
type SubmitRequestedEvent = Extract<
  SpreadsheetImportEvent,
  { type: "SUBMIT.REQUESTED" }
>;
type SubmitFailedEvent = Extract<
  SpreadsheetImportEvent,
  { type: "SUBMIT.FAILED" }
>;

type ReadActorInput = { file: SpreadsheetImportFile };
type SubmitActorInput = { request: SpreadsheetImportRequest };

export const readSpreadsheetFileActor = fromCallback<
  SpreadsheetImportEvent,
  ReadActorInput
>(({ input, sendBack }) => {
  const controller = new AbortController();

  input.file
    .text(controller.signal)
    .then((source) => {
      if (controller.signal.aborted) return;
      sendBack({
        type: "FILE.READ.SUCCEEDED",
        review: {
          fileName: input.file.name,
          result: parsePastedHistory(source),
        },
      });
    })
    .catch(() => {
      if (controller.signal.aborted) return;
      sendBack({ type: "FILE.READ.FAILED" });
    });

  return () => controller.abort();
});

export function createSubmitSpreadsheetImportActor(
  submit: (
    request: SpreadsheetImportRequest,
    signal: AbortSignal,
  ) => Promise<void>,
  formatError: (error: unknown) => string,
) {
  return fromCallback<SpreadsheetImportEvent, SubmitActorInput>(
    ({ input, sendBack }) => {
      const controller = new AbortController();

      submit(input.request, controller.signal)
        .then(() => {
          if (!controller.signal.aborted) {
            sendBack({ type: "SUBMIT.SUCCEEDED" });
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            sendBack({ type: "SUBMIT.FAILED", error: formatError(error) });
          }
        });

      return () => controller.abort();
    },
  );
}

const unavailableSubmitActor = createSubmitSpreadsheetImportActor(
  async () => {
    throw new Error("No spreadsheet import submit actor was provided");
  },
  () => "Spreadsheet import is unavailable.",
);

const initialContext: SpreadsheetImportContext = {
  error: null,
  file: null,
  review: null,
  submission: null,
};

export const spreadsheetImportMachine = setup({
  types: {
    context: {} as SpreadsheetImportContext,
    events: {} as SpreadsheetImportEvent,
  },
  actors: {
    readSpreadsheetFile: readSpreadsheetFileActor,
    submitSpreadsheetImport: unavailableSubmitActor,
  },
  guards: {
    fileTypeIsSupported: ({ event }) =>
      event.type === "FILE.CHOSEN" && FILE_NAME_PATTERN.test(event.file.name),
    fileSizeIsAllowed: ({ event }) =>
      event.type === "FILE.CHOSEN" &&
      event.file.size <= MAX_SPREADSHEET_FILE_BYTES,
    reviewIsValid: ({ context }) =>
      context.review != null &&
      context.review.result.rows.length > 0 &&
      context.review.result.issues.length === 0,
    hasSubmission: ({ context }) => context.submission != null,
  },
  actions: {
    clearWorkflow: assign(() => initialContext),
    queueFile: assign(({ event }) => {
      const chosen = event as FileChosenEvent;
      return {
        error: null,
        file: chosen.file,
        review: null,
        submission: null,
      };
    }),
    rejectFileType: assign({
      error: "Choose a CSV or TSV file exported from your spreadsheet.",
      file: null,
      review: null,
      submission: null,
    }),
    rejectFileSize: assign({
      error: "Choose a file smaller than 1 MB.",
      file: null,
      review: null,
      submission: null,
    }),
    storeReadReview: assign(({ event }) => {
      const succeeded = event as FileReadSucceededEvent;
      return { error: null, file: null, review: succeeded.review };
    }),
    storeReadFailure: assign({
      error: "Asset Tracker could not read that file.",
      file: null,
      review: null,
    }),
    storeSubmission: assign(({ event }) => {
      const requested = event as SubmitRequestedEvent;
      return { error: null, submission: requested.request };
    }),
    storeSubmissionFailure: assign(({ event }) => {
      const failed = event as SubmitFailedEvent;
      return { error: failed.error };
    }),
    clearError: assign({ error: null }),
  },
}).createMachine({
  id: "spreadsheetImport",
  initial: "closed",
  context: initialContext,
  states: {
    closed: {
      entry: "clearWorkflow",
      on: { OPEN: "open.awaitingFile" },
    },
    open: {
      initial: "awaitingFile",
      on: {
        CLOSE: { target: "closed" },
        "FILE.CHOSEN": [
          {
            guard: and(["fileTypeIsSupported", "fileSizeIsAllowed"]),
            target: ".readingFile",
            actions: "queueFile",
          },
          {
            guard: "fileTypeIsSupported",
            target: ".awaitingFile",
            actions: "rejectFileSize",
          },
          { target: ".awaitingFile", actions: "rejectFileType" },
        ],
      },
      states: {
        awaitingFile: {},
        readingFile: {
          invoke: {
            id: "readSpreadsheetFile",
            src: "readSpreadsheetFile",
            input: ({ context }) => ({
              file: context.file as SpreadsheetImportFile,
            }),
          },
          on: {
            "FILE.READ.SUCCEEDED": [
              {
                guard: ({ event }) =>
                  event.review.result.rows.length > 0 &&
                  event.review.result.issues.length === 0,
                target: "reviewReady",
                actions: "storeReadReview",
              },
              {
                target: "reviewInvalid",
                actions: "storeReadReview",
              },
            ],
            "FILE.READ.FAILED": {
              target: "fileReadFailed",
              actions: "storeReadFailure",
            },
          },
        },
        fileReadFailed: {},
        reviewInvalid: {},
        reviewReady: {
          on: {
            "SUBMIT.REQUESTED": {
              guard: "reviewIsValid",
              target: "submitting",
              actions: "storeSubmission",
            },
          },
        },
        submitting: {
          invoke: {
            id: "submitSpreadsheetImport",
            src: "submitSpreadsheetImport",
            input: ({ context }) => ({
              request: context.submission as SpreadsheetImportRequest,
            }),
          },
          on: {
            "SUBMIT.SUCCEEDED": {
              target: "#spreadsheetImport.closed",
            },
            "SUBMIT.FAILED": {
              target: "submissionFailed",
              actions: "storeSubmissionFailure",
            },
          },
        },
        submissionFailed: {
          on: {
            "SUBMIT.REQUESTED": {
              guard: "reviewIsValid",
              target: "submitting",
              actions: "storeSubmission",
            },
            "SUBMIT.RETRY": {
              guard: "hasSubmission",
              target: "submitting",
              actions: "clearError",
            },
          },
        },
      },
    },
  },
});

export interface SpreadsheetImportTraceEntry {
  readonly event: string;
  readonly kind: "event" | "transition";
  readonly state?: string;
}

export function createSpreadsheetImportTrace(
  report?: (entry: SpreadsheetImportTraceEntry) => void,
) {
  const entries: SpreadsheetImportTraceEntry[] = [];

  function record(entry: SpreadsheetImportTraceEntry) {
    entries.push(entry);
    report?.(entry);
  }

  return {
    entries,
    inspect(inspection: InspectionEvent) {
      if (inspection.actorRef.sessionId !== inspection.rootId) return;

      if (inspection.type === "@xstate.event") {
        record({ kind: "event", event: inspection.event.type });
      }
      if (
        inspection.type === "@xstate.snapshot" &&
        "value" in inspection.snapshot
      ) {
        const value = inspection.snapshot.value;
        record({
          kind: "transition",
          event: inspection.event.type,
          state: typeof value === "string" ? value : JSON.stringify(value),
        });
      }
    },
    format() {
      return entries
        .map((entry, index) => {
          const prefix = String(index + 1).padStart(2, "0");
          return entry.kind === "event"
            ? `${prefix} event ${entry.event}`
            : `${prefix} transition ${entry.event} -> ${entry.state}`;
        })
        .join("\n");
    },
  };
}
