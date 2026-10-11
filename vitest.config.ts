import { defineConfig } from "vitest/config";

// Root config: the web workspace runs its own vitest (npm test -w web).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", "web/**"],
  },
});
