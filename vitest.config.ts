import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["tests/server/**/*.test.ts"], fileParallelism: false,
    setupFiles: ["tests/route-trace-setup.ts"], testTimeout: 30000, hookTimeout: 30000 },
});
