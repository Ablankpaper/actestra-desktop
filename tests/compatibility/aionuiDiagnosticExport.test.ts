import { describe, expect, it } from "vitest";
import {
  AIONUI_DIAGNOSTIC_EXPORT_STATUSES,
  AionUiDiagnosticExportError,
  assertAionUiDiagnosticExportResult,
} from "../../apps/desktop/src/compatibility/aionui/diagnosticExport";

describe("AionUI P7.4 diagnostic export contract", () => {
  it("admits only the three closed Renderer-visible statuses", () => {
    expect(AIONUI_DIAGNOSTIC_EXPORT_STATUSES).toEqual(["saved", "cancelled", "rejected"]);
    for (const status of AIONUI_DIAGNOSTIC_EXPORT_STATUSES) {
      expect(() => assertAionUiDiagnosticExportResult({ status })).not.toThrow();
    }
  });

  it("rejects paths, report content, low-level errors, and unknown statuses", () => {
    for (const value of [
      { status: "saved", path: "/private/diagnostics.json" },
      { status: "saved", report: { audit: [] } },
      { status: "rejected", error: "EACCES /private/profile" },
      { status: "uploaded" },
      {},
      null,
    ]) {
      expect(() => assertAionUiDiagnosticExportResult(value)).toThrow(AionUiDiagnosticExportError);
    }
  });
});
