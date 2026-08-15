import { defineConfig } from "vitest/config";

const admittedGooseRunnerIntegrationFiles =
  process.env.ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR !== undefined &&
  process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256 !== undefined
    ? ["tests/security/gooseRunnerParentDeathAbuse.integration.ts"]
    : [];

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx,mjs}", ...admittedGooseRunnerIntegrationFiles],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["apps/desktop/src/**/*.{ts,tsx}"],
      exclude: ["apps/desktop/src/main/index.ts", "apps/desktop/src/preload/index.ts"],
    },
  },
});
