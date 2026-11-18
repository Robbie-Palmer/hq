import { describe, expect, it } from "vitest";
import {
  parseR2CredentialBrokerArguments,
  runBrokerProcess,
} from "../src/r2-temporary-credential-cli";

describe("R2 temporary credential broker CLI", () => {
  it("parses run mode with a consumer command", () => {
    expect(
      parseR2CredentialBrokerArguments([
        "run",
        "--receipt",
        "/tmp/receipt.json",
        "--helper",
        "/tools/r2-helper",
        "--bucket-prefix",
        "hq-r2-canary",
        "--ttl-seconds",
        "900",
        "--",
        "consumer",
        "--live",
      ]),
    ).toEqual({
      mode: "run",
      bucketPrefix: "hq-r2-canary",
      command: "consumer",
      commandArguments: ["--live"],
      helperCommand: "/tools/r2-helper",
      receiptPath: "/tmp/receipt.json",
      ttlSeconds: 900,
    });
  });

  it("parses recovery mode with the default TTL", () => {
    expect(
      parseR2CredentialBrokerArguments([
        "recover",
        "--receipt",
        "/tmp/receipt.json",
        "--helper",
        "/tools/r2-helper",
      ]),
    ).toEqual({
      mode: "recover",
      commandArguments: [],
      helperCommand: "/tools/r2-helper",
      receiptPath: "/tmp/receipt.json",
      ttlSeconds: 1800,
    });
  });

  it.each([
    [[], "Pass run or recover"],
    [["run", "--receipt", "/tmp/receipt", "--helper", "helper"], "consumer command"],
    [["recover", "--receipt", "--helper", "helper"], "--receipt is required"],
  ])("rejects invalid arguments", (arguments_, message) => {
    expect(() => parseR2CredentialBrokerArguments(arguments_)).toThrow(message);
  });

  it("captures a child process result", async () => {
    await expect(
      runBrokerProcess({
        command: process.execPath,
        arguments: [
          "-e",
          'process.stdout.write("out"); process.stderr.write("err")',
        ],
        environment: {},
        inheritOutput: false,
      }),
    ).resolves.toEqual({ exitCode: 0, stdout: "out", stderr: "err" });
  });

  it("maps a child signal to the fail-closed exit code", async () => {
    await expect(
      runBrokerProcess({
        command: process.execPath,
        arguments: ["-e", 'process.kill(process.pid, "SIGTERM")'],
        environment: {},
        inheritOutput: false,
      }),
    ).resolves.toEqual({ exitCode: 75, stdout: "", stderr: "" });
  });
});
