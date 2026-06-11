import { defineConfig } from "vitest/config";

// Tests target the pure engines (no DOM): the ruleset geometry and the lighting
// raycast. Run with `npm test` (CI) or `npm run test:watch` (local).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
  },
});
