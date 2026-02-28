# Spec: JavaScript to TypeScript Migration

## Goal
Rewrite the `sync-calendars` project from JavaScript to TypeScript, following best practices to serve as a portfolio piece demonstrating strong TypeScript skills.

## Decisions

### TypeScript Configuration
- **Strict mode: fully enabled** (`strict: true` in `tsconfig.json`)
- Includes `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `alwaysStrict`

### Project Restructuring
Migrate from flat structure to `src/` convention:

```
src/
  server.ts                    # Express app entry point
  config/
    env.ts                     # Zod-validated environment variables
  services/
    browser-pool.ts            # BrowserPool class (singleton)
    proxy-manager.ts           # ProxyManager class (singleton)
  scrapers/
    oponeo.ts                  # Oponeo scraping functions (authenticate, scrape, etc.)
  routes/
    oponeo-scraper.ts          # Oponeo Express router (scraper/mutator/obliterator)
    wo-events.ts               # WO events Express router
  utils/
    dates.ts                   # Date/time conversion utilities
    logger.ts                  # Winston logger configuration
    browser.ts                 # Browser creation helpers (createBrowserInstance, createBrowserContext, randomDelay)
  types/
    index.ts                   # Shared interfaces and type definitions
tests/
  unit/
    dates.test.ts
    proxy-manager.test.ts
  integration/
    wo-events.test.ts
    context-sharing.test.ts
  functional/
    scraper-functions.test.ts
  fixtures/
    reservation-list.html
    reservation-detail.html
```

### Dependency Changes
- **Add:** `typescript`, `ts-jest`, `@types/express`, `@types/node`, `zod`, `date-fns`
- **Add (dev):** `eslint`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `prettier`, `eslint-config-prettier`
- **Remove:** `moment` (replaced by `date-fns`)

### Environment Variable Validation
- Use **Zod** to define a schema for all env vars in `src/config/env.ts`
- Validate at startup; fail fast with clear error messages
- Dynamic `WEBSHARE_ACCOUNT_*` detection handled via Zod's `.passthrough()` or manual extraction with typed output

### Date Library
- Replace `moment.js` with `date-fns`
- Migrate: `moment().format()` → `format()`, `moment().utc()` → `formatISO()`, etc.
- Custom tick conversion functions remain (no library equivalent)

### Linting & Formatting
- **ESLint** with `@typescript-eslint` strict preset
- **Prettier** for code formatting
- `eslint-config-prettier` to avoid rule conflicts
- Add `lint` and `format` npm scripts
- Update Husky pre-commit hook to run lint + tests

### Testing
- **`ts-jest`** for TypeScript compilation in tests
- **Type-safe mocking** using `jest.MockedFunction<typeof fn>` and properly typed return values
- Tests remain in `tests/` directory (not inside `src/`)
- Update `jest.config.ts` (also converted to TypeScript) with `ts-jest` preset

### Class Architecture
- `BrowserPool` and `ProxyManager` remain as **classes with singleton exports**
- Add proper TypeScript visibility modifiers (`private`, `readonly`)
- Strongly type all method signatures, return types, and internal state

### Docker
- **Multi-stage build:**
  - Stage 1 (`builder`): Install all deps, compile TypeScript → `dist/`
  - Stage 2 (`runtime`): Copy `dist/` + production deps only, base on Playwright image
- Update `compose.yaml` accordingly
- `CMD ["node", "dist/server.js"]`

### Code Comments
- Comments should be **logically structured** — explain *why*, not *what*
- Group related logic with section comments where appropriate
- No AI attribution or signatures in comments or commits

### Commit Messages
- Keep commits **short but glanceable** — concise enough to scan quickly, clear enough to understand the change
- No AI co-author attribution

### npm Scripts
```json
{
  "build": "tsc",
  "start": "node dist/server.js",
  "dev": "tsc --watch",
  "lint": "eslint src/ tests/",
  "format": "prettier --write src/ tests/",
  "test": "jest",
  "test:unit": "jest tests/unit",
  "test:integration": "jest tests/integration",
  "test:functional": "jest tests/functional",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage"
}
```
