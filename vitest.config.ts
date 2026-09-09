import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Only the pure-function suites. evals/ hits a live model host and is run
    // manually via `npm run eval`, never as part of `vitest run`.
    include: ["tests/**/*.test.ts"],
  },
});
