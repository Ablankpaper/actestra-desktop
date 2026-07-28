import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx,mjs}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["apps/desktop/src/**/*.{ts,tsx}"],
      exclude: [
        "apps/desktop/src/main/index.ts",
        "apps/desktop/src/preload/index.ts",
        "apps/desktop/src/renderer/main.tsx",
        "apps/desktop/src/renderer/env.d.ts",
      ],
    },
  },
});
