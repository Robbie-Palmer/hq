import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  boundedInteger,
  enforceUnoSramBudget,
  parseCompileReport,
  unoFreeBytes,
  validatedArduinoCliPath,
} from "./compile-firmware.ts";

void describe("boundedInteger", () => {
  void it("uses the default when the environment setting is absent", () => {
    assert.equal(boundedInteger("SETTING", undefined, 7, 0, 10), 7);
  });

  void it("accepts both bounds", () => {
    assert.equal(boundedInteger("SETTING", "0", 7, 0, 10), 0);
    assert.equal(boundedInteger("SETTING", "10", 7, 0, 10), 10);
  });

  void it("rejects malformed and out-of-range values", () => {
    const message = "SETTING must be an integer from 0 to 10";
    for (const value of ["", "-1", "11", "1.5", "not-a-number"]) {
      assert.throws(() => boundedInteger("SETTING", value, 7, 0, 10), {
        message,
      });
    }
  });
});

void describe("validatedArduinoCliPath", () => {
  void it("accepts an absolute path to the expected executable", () => {
    assert.equal(
      validatedArduinoCliPath("/opt/mise/arduino-cli/1.5.1/arduino-cli"),
      "/opt/mise/arduino-cli/1.5.1/arduino-cli",
    );
  });

  void it("rejects PATH lookup and a different executable", () => {
    const message =
      "Mise must provide the absolute path to its pinned arduino-cli executable";
    assert.throws(() => validatedArduinoCliPath("arduino-cli"), { message });
    assert.throws(() => validatedArduinoCliPath("/usr/bin/other"), { message });
  });
});

void describe("Uno compile reports", () => {
  void it("extracts compiler output and the remaining SRAM", () => {
    const report = parseCompileReport(
      JSON.stringify({
        builder_result: {
          executable_sections_size: [
            { max_size: 32_256, name: "text", size: 12_345 },
            { max_size: 2_048, name: "data", size: 1_213 },
          ],
        },
        compiler_err: "warning\n",
        compiler_out: "compiled\n",
        success: true,
      }),
    );

    assert.equal(report.compilerOutput, "compiled\n");
    assert.equal(report.compilerError, "warning\n");
    assert.equal(unoFreeBytes(report), 835);
  });

  void it("rejects malformed JSON", () => {
    assert.throws(() => parseCompileReport("{"), {
      message: /^Unable to parse the Arduino CLI JSON report:/,
    });
  });

  void it("requires a successful report with a data section", () => {
    const report = parseCompileReport(JSON.stringify({ success: false }));
    assert.throws(() => unoFreeBytes(report), {
      message: "Arduino CLI did not report a successful Uno SRAM measurement.",
    });
  });

  void it("rejects a report below the configured SRAM floor", () => {
    const report = parseCompileReport(
      JSON.stringify({
        builder_result: {
          executable_sections_size: [
            { max_size: 2_048, name: "data", size: 1_300 },
          ],
        },
        success: true,
      }),
    );

    assert.throws(() => enforceUnoSramBudget(report), {
      message: "Uno firmware exceeds the static SRAM budget.",
    });
  });
});
