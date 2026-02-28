# Brainstorming Q&A

## Q1: TypeScript Strictness Level
**Q:** What level of TypeScript strictness do you want to target? For a portfolio piece, `strict: true` (which enables `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, etc.) is the gold standard and signals to employers that you understand type safety deeply. However, it requires more upfront effort — especially for things like your `BrowserPool` and `ProxyManager` classes where there's dynamic behavior. Are you aiming for full strict mode, or would you prefer a more gradual approach (start lenient, tighten over time)?

**A:** Full strict mode.

## Q2: Module Restructuring
**Q:** Your `utils.js` is 856 lines and contains a lot of different concerns: logging, date utilities, browser pool management, proxy management, and scraping functions. Do you want to break it up into separate modules as part of this migration (e.g., `src/utils/dates.ts`, `src/services/browser-pool.ts`, `src/services/proxy-manager.ts`, `src/scrapers/oponeo.ts`), or keep the current file structure and just convert the existing files in-place? Restructuring would better demonstrate clean architecture to a potential employer, but it's more work.

**A:** Yes, restructure it.

## Q3: ESLint and Prettier
**Q:** Your project currently has no ESLint or Prettier configured. Since you're doing a full migration and want to showcase best practices, do you want to add TypeScript-aware linting and formatting as part of this effort? For example, `@typescript-eslint/eslint-plugin` with a strict preset, plus Prettier for consistent formatting. This is often one of the first things employers look at in a codebase — it signals discipline and attention to code quality.

**A:** Yes, add both.

## Q4: Test Transpiler
**Q:** Your test suite currently uses Jest with plain JavaScript. Jest has decent TypeScript support via `ts-jest` or SWC-based transforms. Do you have a preference between: (1) `ts-jest` — the classic approach, uses the TypeScript compiler directly, catches type errors during test runs but slower, or (2) `@swc/jest` — much faster transpilation, but only strips types without checking them (type errors caught by `tsc` separately). For a portfolio piece, either works well. `ts-jest` is more "traditional" and catches more at test time; `@swc/jest` is the modern choice that keeps test runs fast (you'd rely on a separate `tsc --noEmit` check for type safety).

**A:** `ts-jest` (option 1).

## Q5: Environment Variable Validation
**Q:** Your `ProxyManager` class dynamically detects `WEBSHARE_ACCOUNT_*` environment variables at runtime and builds proxy lists from them. In strict TypeScript, this kind of dynamic env access needs careful typing. How do you want to handle environment variable validation? (1) Runtime validation with a library like `zod` — define a schema for all your env vars, validate at startup, and get full type inference. This is the modern best practice and very impressive in a portfolio. (2) Simple typed config module — a manual `config.ts` that reads and asserts env vars with basic checks, simpler but less robust.

**A:** Zod runtime validation (option 1).

## Q6: Date Library Replacement
**Q:** Your project uses `moment.js` for date handling. Moment is officially in maintenance mode and is considered a legacy library. Since you're already doing a full rewrite, do you want to replace it with a modern alternative? (1) `date-fns` — lightweight, tree-shakeable, functional approach (most popular modern choice). (2) `dayjs` — tiny, moment-compatible API so migration is minimal. (3) Keep `moment` — it works, and the migration focus is TypeScript, not dependencies.

**A:** `date-fns` (option 1).

## Q7: Project Structure
**Q:** Your current project structure is flat — `server.js`, `utils.js`, and `routes/` all live at the root. For the restructured TypeScript project, do you want to adopt a `src/` directory convention with the proposed structure (src/ with config/, services/, scrapers/, routes/, utils/, types/ subdirectories, tests/ mirroring src/)?

**A:** Yes, adopt the proposed `src/` directory structure.

## Q8: Docker Build Strategy
**Q:** Your Dockerfile currently uses `node server.js` directly. With TypeScript, you'll need a build step. For the production container, do you want to: (1) Build locally / in CI, copy compiled JS into the container — smaller image, no dev dependencies in production, industry standard. (2) Multi-stage Docker build — build inside Docker (stage 1: compile TS, stage 2: copy only JS output + production deps). Fully self-contained, reproducible builds, no local build step needed.

**A:** Multi-stage Docker build (option 2).

## Q9: Singleton vs Dependency Injection
**Q:** Your `BrowserPool` and `ProxyManager` are currently classes using the singleton pattern (exported as module-level instances). In TypeScript, there are a few ways to handle this cleanly: (1) Keep as classes with explicit singleton exports — add proper typing with private fields, generics where appropriate, and export typed singleton instances. Straightforward and familiar. (2) Refactor to proper dependency injection — classes receive their dependencies via constructor, singletons managed at the composition root (`server.ts`). More testable, more impressive architecturally, and makes mocking in tests cleaner.

**A:** Keep as classes with explicit singleton exports (option 1).

## Q10: Type-Safe Mocking in Tests
**Q:** Your tests currently mock things like `fetch`, `BrowserPool`, and DOM parsing with JSDOM. When migrating the tests to TypeScript, do you want to also add type-safe mocking? For example, using `jest.MockedFunction<typeof fetch>` and properly typed mock return values, rather than just `jest.fn()` with untyped returns. This ensures your mocks stay in sync with the actual implementations — if a function signature changes, the tests won't compile until the mocks are updated too.

**A:** Yes, use type-safe mocking.

## Q11: Code Comments and Commit Style
**Q:** Any preferences for code comments and attribution?

**A:** Comments should be logically structured. Do not sign as Claude in comments or commits.

## Q12: Commit Style
**Q:** Any preferences for commit messages?

**A:** Keep commits as short as possible but still reasonable — understanding at a glance is important. No AI attribution.
