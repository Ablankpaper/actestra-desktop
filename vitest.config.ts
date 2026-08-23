import { defineConfig } from "vitest/config";

const admittedGooseRunnerIntegrationFiles =
  process.env.ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR !== undefined &&
  process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256 !== undefined
    ? ["tests/security/gooseRunnerParentDeathAbuse.integration.ts"]
    : [];
const nativeLinuxGooseIntegrationFiles =
  process.env.ACTESTRA_GOOSE_NATIVE_INTEGRATION === "1" &&
  process.env.ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR !== undefined &&
  process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256 !== undefined
    ? ["tests/main/gooseRunnerLinuxNative.integration.ts"]
    : [];
const nativeWindowsGooseIntegrationFiles =
  process.env.ACTESTRA_GOOSE_WINDOWS_RUNTIME_INTEGRATION === "1" &&
  process.env.ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR !== undefined &&
  process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256 !== undefined &&
  process.env.ACTESTRA_GOOSE_WINDOWS_RUNTIME_EVIDENCE_PATH !== undefined &&
  process.env.ACTESTRA_GOOSE_WINDOWS_RUNTIME_FAILURE_EVIDENCE_PATH !== undefined &&
  process.env.ACTESTRA_GOOSE_CONTAINMENT_EVIDENCE_SHA256 !== undefined
    ? ["tests/main/gooseRunnerWindowsNative.integration.ts"]
    : [];

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: [
      "tests/**/*.test.{ts,tsx,mjs}",
      ...admittedGooseRunnerIntegrationFiles,
      ...nativeLinuxGooseIntegrationFiles,
      ...nativeWindowsGooseIntegrationFiles,
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["apps/desktop/src/**/*.{ts,tsx}"],
      exclude: ["apps/desktop/src/main/index.ts", "apps/desktop/src/preload/index.ts"],
    },
  },
});
