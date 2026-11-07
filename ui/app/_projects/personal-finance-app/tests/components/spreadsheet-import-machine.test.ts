import { describe, expect, it, vi } from "vitest";
import { createActor, waitFor } from "xstate";
import {
  getAdjacencyMap,
  getPathsFromEvents,
  getShortestPaths,
  getSimplePaths,
} from "xstate/graph";
import {
  createSpreadsheetImportTrace,
  createSubmitSpreadsheetImportActor,
  MAX_SPREADSHEET_FILE_BYTES,
  type SpreadsheetFileReview,
  type SpreadsheetImportEvent,
  type SpreadsheetImportFile,
  type SpreadsheetImportRequest,
  spreadsheetImportMachine,
} from "@/app/_projects/personal-finance-app/components/spreadsheet-import-machine";

const validReview: SpreadsheetFileReview = {
  fileName: "balances.csv",
  result: {
    rows: [{ date: "2024-01-31", value: 12_500 }],
    issues: [],
  },
};
const invalidReview: SpreadsheetFileReview = {
  fileName: "balances.csv",
  result: {
    rows: [],
    issues: [
      {
        line: 2,
        message: "Use YYYY-MM-DD for the date",
        source: "not-a-date,12500",
      },
    ],
  },
};
const request: SpreadsheetImportRequest = {
  kind: "balances",
  accountId: "stocks-isa",
  ownership: { kind: "personal", memberId: "alex" },
  rows: validReview.result.rows,
};

type ExpectedState =
  | "closed"
  | "open"
  | {
      open?:
        | "awaitingFile"
        | "readingFile"
        | "fileReadFailed"
        | "reviewInvalid"
        | "reviewReady"
        | "submitting"
        | "submissionFailed";
    };

function spreadsheetFile(
  contents: string,
  overrides: Partial<SpreadsheetImportFile> = {},
): SpreadsheetImportFile {
  return {
    name: "balances.csv",
    size: contents.length,
    text: vi.fn().mockResolvedValue(contents),
    ...overrides,
  };
}

function startMachine(
  submit: (
    request: SpreadsheetImportRequest,
    signal: AbortSignal,
  ) => Promise<void> = vi.fn().mockResolvedValue(undefined),
) {
  const trace = createSpreadsheetImportTrace();
  const actor = createActor(
    spreadsheetImportMachine.provide({
      actors: {
        submitSpreadsheetImport: createSubmitSpreadsheetImportActor(
          submit,
          () => "Something went wrong",
        ),
      },
    }),
    { inspect: trace.inspect },
  ).start();
  return { actor, trace };
}

async function expectState(
  running: ReturnType<typeof startMachine>,
  state: ExpectedState,
) {
  try {
    return await waitFor(running.actor, (snapshot) => snapshot.matches(state), {
      timeout: 1_000,
    });
  } catch (error) {
    throw new Error(
      `Timed out waiting for ${JSON.stringify(state)}.\n${running.trace.format()}`,
      { cause: error },
    );
  }
}

async function reachReady(running: ReturnType<typeof startMachine>) {
  running.actor.send({ type: "OPEN" });
  running.actor.send({
    type: "FILE.CHOSEN",
    file: spreadsheetFile("date,value\n2024-01-31,12500"),
  });
  return expectState(running, { open: "reviewReady" });
}

describe("spreadsheetImportMachine", () => {
  it("reads, reviews, submits, closes, and clears a valid import", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const running = startMachine(submit);

    await reachReady(running);
    expect(running.actor.getSnapshot().context.review).toEqual(validReview);

    running.actor.send({ type: "SUBMIT.REQUESTED", request });
    await expectState(running, "closed");

    expect(submit).toHaveBeenCalledWith(request, expect.any(AbortSignal));
    expect(running.actor.getSnapshot().context).toEqual({
      error: null,
      file: null,
      review: null,
      submission: null,
    });
    running.actor.stop();
  });

  it("recovers from read, review, and submission failures before retrying", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("Storage failed"))
      .mockResolvedValueOnce(undefined);
    const running = startMachine(submit);

    running.actor.send({ type: "OPEN" });
    running.actor.send({
      type: "FILE.CHOSEN",
      file: spreadsheetFile("", {
        text: vi.fn().mockRejectedValue(new Error("Read failed")),
      }),
    });
    await expectState(running, { open: "fileReadFailed" });
    expect(running.actor.getSnapshot().context.error).toMatch(
      /could not read/i,
    );

    running.actor.send({
      type: "FILE.CHOSEN",
      file: spreadsheetFile("date,value\nnot-a-date,12500"),
    });
    await expectState(running, { open: "reviewInvalid" });
    expect(
      running.actor.getSnapshot().context.review?.result.issues,
    ).toHaveLength(1);

    running.actor.send({
      type: "FILE.CHOSEN",
      file: spreadsheetFile("date,value\n2024-01-31,12500"),
    });
    await expectState(running, { open: "reviewReady" });
    running.actor.send({ type: "SUBMIT.REQUESTED", request });
    await expectState(running, { open: "submissionFailed" });
    expect(running.actor.getSnapshot().context.error).toBe(
      "Something went wrong",
    );

    running.actor.send({ type: "SUBMIT.RETRY" });
    await expectState(running, "closed");
    expect(submit).toHaveBeenCalledTimes(2);
    running.actor.stop();
  });

  it("rejects unsupported and oversized files before starting a read", () => {
    const running = startMachine();
    const unsupportedText = vi.fn().mockResolvedValue("2024-01-31,1");
    const oversizedText = vi.fn().mockResolvedValue("2024-01-31,1");

    running.actor.send({ type: "OPEN" });
    running.actor.send({
      type: "FILE.CHOSEN",
      file: spreadsheetFile("", {
        name: "balances.xlsx",
        text: unsupportedText,
      }),
    });
    expect(running.actor.getSnapshot().context.error).toMatch(/CSV or TSV/);
    running.actor.send({
      type: "FILE.CHOSEN",
      file: spreadsheetFile("", {
        size: MAX_SPREADSHEET_FILE_BYTES + 1,
        text: oversizedText,
      }),
    });
    expect(running.actor.getSnapshot().context.error).toMatch(
      /smaller than 1 MB/,
    );
    expect(unsupportedText).not.toHaveBeenCalled();
    expect(oversizedText).not.toHaveBeenCalled();
    running.actor.stop();
  });

  it("stops an in-flight file reader when the drawer closes", async () => {
    let readSignal: AbortSignal | undefined;
    let resolveRead: (source: string) => void = () => undefined;
    const running = startMachine();
    const pendingRead = new Promise<string>((resolve) => {
      resolveRead = resolve;
    });

    running.actor.send({ type: "OPEN" });
    running.actor.send({
      type: "FILE.CHOSEN",
      file: spreadsheetFile("", {
        text: vi.fn((signal?: AbortSignal) => {
          readSignal = signal;
          return pendingRead;
        }),
      }),
    });
    await expectState(running, { open: "readingFile" });
    expect(readSignal?.aborted).toBe(false);

    running.actor.send({ type: "CLOSE" });
    expect(running.actor.getSnapshot().matches("closed")).toBe(true);
    expect(readSignal?.aborted).toBe(true);
    expect(running.actor.getSnapshot().children).toEqual({});
    resolveRead("2024-01-31,12500");
    await Promise.resolve();
    expect(running.actor.getSnapshot().matches("closed")).toBe(true);
    running.actor.stop();
  });

  it("stops an in-flight submitter when the drawer closes", async () => {
    let submitSignal: AbortSignal | undefined;
    let resolveSubmit: () => void = () => undefined;
    const submit = vi.fn(
      (_request: SpreadsheetImportRequest, signal: AbortSignal) => {
        submitSignal = signal;
        return new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        });
      },
    );
    const running = startMachine(submit);

    await reachReady(running);
    running.actor.send({ type: "SUBMIT.REQUESTED", request });
    await expectState(running, { open: "submitting" });
    expect(submitSignal?.aborted).toBe(false);

    running.actor.send({ type: "CLOSE" });
    expect(running.actor.getSnapshot().matches("closed")).toBe(true);
    expect(submitSignal?.aborted).toBe(true);
    expect(running.actor.getSnapshot().children).toEqual({});
    resolveSubmit();
    await Promise.resolve();
    expect(running.actor.getSnapshot().matches("closed")).toBe(true);
    running.actor.stop();
  });

  it("ignores outcome and retry events outside their owning states", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const running = startMachine(submit);
    const forbiddenEvents: SpreadsheetImportEvent[] = [
      { type: "FILE.READ.SUCCEEDED", review: validReview },
      { type: "FILE.READ.FAILED" },
      { type: "SUBMIT.REQUESTED", request },
      { type: "SUBMIT.RETRY" },
      { type: "SUBMIT.SUCCEEDED" },
      { type: "SUBMIT.FAILED", error: "should be ignored" },
    ];

    for (const event of forbiddenEvents) running.actor.send(event);
    expect(running.actor.getSnapshot().matches("closed")).toBe(true);

    running.actor.send({ type: "OPEN" });
    for (const event of forbiddenEvents.slice(0, 2)) running.actor.send(event);
    expect(running.actor.getSnapshot().matches({ open: "awaitingFile" })).toBe(
      true,
    );

    running.actor.send({
      type: "FILE.CHOSEN",
      file: spreadsheetFile("date,value\nnot-a-date,12500"),
    });
    await expectState(running, { open: "reviewInvalid" });
    running.actor.send({ type: "SUBMIT.REQUESTED", request });
    running.actor.send({ type: "SUBMIT.SUCCEEDED" });
    expect(running.actor.getSnapshot().matches({ open: "reviewInvalid" })).toBe(
      true,
    );
    expect(running.actor.getSnapshot().context.submission).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    running.actor.stop();
  });

  it("records named events and resulting states for a failing sequence", async () => {
    const running = startMachine(
      vi.fn().mockRejectedValue(new Error("Storage failed")),
    );

    await reachReady(running);
    running.actor.send({ type: "SUBMIT.REQUESTED", request });
    await expectState(running, { open: "submissionFailed" });

    expect(running.trace.format()).toContain(
      'transition SUBMIT.FAILED -> {"open":"submissionFailed"}',
    );
    expect(running.trace.format()).toContain("event SUBMIT.REQUESTED");
    running.actor.stop();
  });
});

describe("spreadsheetImportMachine graph", () => {
  const graphFile = spreadsheetFile("date,value\n2024-01-31,12500");
  const unsupportedGraphFile = spreadsheetFile("", { name: "balances.xlsx" });
  const oversizedGraphFile = spreadsheetFile("", {
    size: MAX_SPREADSHEET_FILE_BYTES + 1,
  });
  const graphEvents: SpreadsheetImportEvent[] = [
    { type: "OPEN" },
    { type: "CLOSE" },
    { type: "FILE.CHOSEN", file: graphFile },
    { type: "FILE.CHOSEN", file: unsupportedGraphFile },
    { type: "FILE.CHOSEN", file: oversizedGraphFile },
    { type: "FILE.READ.SUCCEEDED", review: validReview },
    { type: "FILE.READ.SUCCEEDED", review: invalidReview },
    { type: "FILE.READ.FAILED" },
    { type: "SUBMIT.REQUESTED", request },
    { type: "SUBMIT.RETRY" },
    { type: "SUBMIT.SUCCEEDED" },
    { type: "SUBMIT.FAILED", error: "Storage failed" },
  ];
  const traversalOptions = {
    events: graphEvents,
    limit: 128,
    serializeEvent: (event: SpreadsheetImportEvent) => {
      if (event.type === "FILE.CHOSEN") {
        const kind = event.file.name.endsWith(".xlsx")
          ? "unsupported"
          : event.file.size > MAX_SPREADSHEET_FILE_BYTES
            ? "oversized"
            : "valid";
        return `${event.type}:${kind}`;
      }
      if (event.type === "FILE.READ.SUCCEEDED") {
        return `${event.type}:${event.review.result.issues.length}`;
      }
      return event.type;
    },
    serializeState: (state: { value: unknown }) => JSON.stringify(state.value),
  };

  it("reaches every explicit stable state within the traversal bound", () => {
    const states = new Set(
      getShortestPaths(spreadsheetImportMachine, traversalOptions).map((path) =>
        JSON.stringify(path.state.value),
      ),
    );

    expect(states).toEqual(
      new Set([
        '"closed"',
        '{"open":"awaitingFile"}',
        '{"open":"readingFile"}',
        '{"open":"fileReadFailed"}',
        '{"open":"reviewInvalid"}',
        '{"open":"reviewReady"}',
        '{"open":"submitting"}',
        '{"open":"submissionFailed"}',
      ]),
    );
  });

  it("covers every declared transition with bounded graph paths", () => {
    const simplePaths = getSimplePaths(
      spreadsheetImportMachine,
      traversalOptions,
    );
    const events = new Set(
      simplePaths.flatMap((path) => path.steps.map((step) => step.event.type)),
    );
    const adjacency = getAdjacencyMap(
      spreadsheetImportMachine,
      traversalOptions,
    );

    expect(Object.keys(adjacency)).toHaveLength(8);
    expect(simplePaths).toHaveLength(8);
    const transitionEvents = new Set(
      Object.values(adjacency).flatMap(({ state, transitions }) =>
        (
          Object.values(transitions) as Array<{
            event: SpreadsheetImportEvent;
            state: { value: unknown };
          }>
        )
          .filter(
            (transition) =>
              JSON.stringify(transition.state.value) !==
              JSON.stringify(state.value),
          )
          .map((transition) => transition.event.type),
      ),
    );
    expect(transitionEvents).toEqual(
      new Set([
        "OPEN",
        "CLOSE",
        "FILE.CHOSEN",
        "FILE.READ.SUCCEEDED",
        "FILE.READ.FAILED",
        "SUBMIT.REQUESTED",
        "SUBMIT.RETRY",
        "SUBMIT.SUCCEEDED",
        "SUBMIT.FAILED",
      ]),
    );
    expect(events).toContain("FILE.READ.SUCCEEDED");
  });

  it("checks every declared transition with targeted bounded sequences", () => {
    const sequences: Array<{
      events: SpreadsheetImportEvent[];
      state: ExpectedState;
    }> = [
      { events: [{ type: "OPEN" }], state: { open: "awaitingFile" } },
      {
        events: [
          { type: "OPEN" },
          { type: "FILE.CHOSEN", file: unsupportedGraphFile },
        ],
        state: { open: "awaitingFile" },
      },
      {
        events: [
          { type: "OPEN" },
          { type: "FILE.CHOSEN", file: oversizedGraphFile },
        ],
        state: { open: "awaitingFile" },
      },
      {
        events: [{ type: "OPEN" }, { type: "FILE.CHOSEN", file: graphFile }],
        state: { open: "readingFile" },
      },
      {
        events: [
          { type: "OPEN" },
          { type: "FILE.CHOSEN", file: graphFile },
          { type: "FILE.READ.FAILED" },
        ],
        state: { open: "fileReadFailed" },
      },
      {
        events: [
          { type: "OPEN" },
          { type: "FILE.CHOSEN", file: graphFile },
          { type: "FILE.READ.SUCCEEDED", review: invalidReview },
        ],
        state: { open: "reviewInvalid" },
      },
      {
        events: [
          { type: "OPEN" },
          { type: "FILE.CHOSEN", file: graphFile },
          { type: "FILE.READ.SUCCEEDED", review: validReview },
        ],
        state: { open: "reviewReady" },
      },
      {
        events: [
          { type: "OPEN" },
          { type: "FILE.CHOSEN", file: graphFile },
          { type: "FILE.READ.SUCCEEDED", review: validReview },
          { type: "SUBMIT.REQUESTED", request },
        ],
        state: { open: "submitting" },
      },
      {
        events: [
          { type: "OPEN" },
          { type: "FILE.CHOSEN", file: graphFile },
          { type: "FILE.READ.SUCCEEDED", review: validReview },
          { type: "SUBMIT.REQUESTED", request },
          { type: "SUBMIT.SUCCEEDED" },
        ],
        state: "closed",
      },
      {
        events: [
          { type: "OPEN" },
          { type: "FILE.CHOSEN", file: graphFile },
          { type: "FILE.READ.SUCCEEDED", review: validReview },
          { type: "SUBMIT.REQUESTED", request },
          { type: "SUBMIT.FAILED", error: "Storage failed" },
        ],
        state: { open: "submissionFailed" },
      },
      {
        events: [
          { type: "OPEN" },
          { type: "FILE.CHOSEN", file: graphFile },
          { type: "FILE.READ.SUCCEEDED", review: validReview },
          { type: "SUBMIT.REQUESTED", request },
          { type: "SUBMIT.FAILED", error: "Storage failed" },
          { type: "SUBMIT.RETRY" },
        ],
        state: { open: "submitting" },
      },
      {
        events: [
          { type: "OPEN" },
          { type: "FILE.CHOSEN", file: graphFile },
          { type: "FILE.READ.SUCCEEDED", review: validReview },
          { type: "SUBMIT.REQUESTED", request },
          { type: "SUBMIT.FAILED", error: "Storage failed" },
          { type: "SUBMIT.REQUESTED", request },
        ],
        state: { open: "submitting" },
      },
      {
        events: [
          { type: "OPEN" },
          { type: "FILE.CHOSEN", file: graphFile },
          { type: "CLOSE" },
        ],
        state: "closed",
      },
    ];

    for (const sequence of sequences) {
      const [path] = getPathsFromEvents(
        spreadsheetImportMachine,
        sequence.events,
        traversalOptions,
      );
      expect(path?.state.matches(sequence.state)).toBe(true);
    }
  });
});
