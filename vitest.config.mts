import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Exists for one reason: the `@/` path alias. `tsconfig.json` maps `@/*` to
 * the repo root for Next and the typechecker, but vitest does not read
 * tsconfig paths, so any module under test that imports through the alias
 * fails to resolve without this. `lib/stream.test.ts` never needed it because
 * `lib/stream.ts` imports nothing through `@/`; `lib/contentEmails.ts` does.
 *
 * Everything else is the default — no environment, setup, or coverage
 * configuration. The repo deliberately has no test infrastructure beyond
 * targeted vitest files (build plan, "Not in this plan").
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.dirname(fileURLToPath(import.meta.url)),
    },
  },
});
