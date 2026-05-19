import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    hookTimeout: 10_000,
    testTimeout: 20_000,
    exclude: ["dist/**", "node_modules/**"],
    restoreMocks: true
  }
});
