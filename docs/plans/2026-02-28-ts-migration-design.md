# TypeScript Migration Design

## Context

The sync-calendars project is being migrated from JavaScript to TypeScript to serve as a portfolio piece. The goal is full strict mode, clean architecture, and modern tooling — demonstrating strong TypeScript skills to potential employers.

## Approach

Big-bang rewrite: convert all files at once, restructure into `src/`, get everything compiling in one pass. The codebase is compact (~1,500 lines across 4 source files) with a test suite to validate correctness.

## Project Structure

```
src/
  server.ts
  config/
    env.ts                     # Zod-validated environment variables
  services/
    browser-pool.ts            # BrowserPool class (singleton)
    proxy-manager.ts           # ProxyManager class (singleton)
  scrapers/
    oponeo.ts                  # authenticate, scrape, pagination, details
  routes/
    oponeo-scraper.ts          # /oponeo router (scraper, mutator, obliterator)
    wo-events.ts               # /wo router (events)
  utils/
    dates.ts                   # Date/time conversions + tick constants
    logger.ts                  # Winston logger
    browser.ts                 # createBrowserInstance, createBrowserContext, randomDelay
  types/
    index.ts                   # Shared interfaces
tests/
  unit/
    dates.test.ts
    proxy-manager.test.ts
    browser-pool.test.ts
  integration/
    wo-events.test.ts
    context-sharing.test.ts
  functional/
    scraper-functions.test.ts
  fixtures/
    reservation-list.html      # Unchanged
    reservation-detail.html    # Unchanged
```

## Type Definitions

Core interfaces in `src/types/index.ts`:

- **Proxy system:** `Proxy`, `ProxyCredentials`, `ProxyList`, `ProxyResult`
- **Browser pool:** `BrowserContextResult`
- **Scraping:** `ReservationListItem`, `ReservationDetails`, `PaginatedReservations`
- **Routes:** `MutatorReservation`, `MutatorResult`, `ObliteratorResult`
- Playwright types (`Browser`, `BrowserContext`, `Page`) from `playwright` built-in definitions

## Environment Validation

`src/config/env.ts` using Zod:

- Core schema validates known vars: `PORT`, `OPONEO_*`, `WO_API_KEY`, `PROXY_BLACKLIST`
- `WO_API_KEY` optional (validated at route level)
- Dynamic `WEBSHARE_ACCOUNT_*` extracted separately via `extractWebshareAccounts()` returning `Map<number, string>`
- Startup fails fast with clear error messages
- All `process.env` access replaced with typed `env.*` imports

## Dependency Changes

**Add (production):** `typescript`, `zod`, `date-fns`
**Add (dev):** `ts-jest`, `@types/express`, `@types/node`, `eslint`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `prettier`, `eslint-config-prettier`
**Remove:** `moment`

### moment -> date-fns migration

- `getCurrentDateMidnight`: replaced with native `Date` UTC manipulation (no library needed)
- Tests referencing `moment` rewritten with native `Date` arithmetic
- `date-fns` available for any future date formatting needs

## TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- `ES2022` for native BigInt, modern features
- `Node16` module resolution
- Full `strict: true`

## Linting & Formatting

- **ESLint** flat config (`eslint.config.mjs`) with `@typescript-eslint/strict-type-checked`
- **Prettier** (`.prettierrc`) with tabs, single quotes, trailing commas (matching existing style)
- `eslint-config-prettier` to avoid conflicts
- Husky pre-commit: `npm run lint && npm test`

## Docker

Multi-stage build with `tini` for proper signal handling:

```dockerfile
# Stage 1: Build
FROM mcr.microsoft.com/playwright:v1.57.0 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Stage 2: Runtime
FROM mcr.microsoft.com/playwright:v1.57.0
RUN apt-get update && apt-get install -y vim tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
EXPOSE 3001
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/server.js"]
```

## Testing

- `ts-jest` preset for TypeScript compilation in tests
- Type-safe mocking with `jest.MockedFunction<typeof fn>`
- `utils.test.js` splits into `dates.test.ts`, `proxy-manager.test.ts`, `browser-pool.test.ts`
- `moment` references in tests replaced with native Date operations
- `jest.config.ts` with path aliases (`@/` -> `src/`)

## npm Scripts

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

## Class Architecture

- `BrowserPool` and `ProxyManager` remain as classes with singleton exports
- Private fields, readonly where appropriate, typed method signatures
- No dependency injection — kept simple

## Code Standards

- Comments logically structured, explain *why* not *what*
- No AI attribution in comments or commits
- Commits short but glanceable

## What Doesn't Change

- `workflows/` (N8N JSON files)
- `scripts/` (backup/restore shell scripts)
- `tests/fixtures/` (HTML fixtures)
- `.env`, `.env.example`, `.gitignore`, `.dockerignore`
- All API endpoints, request/response shapes, and business logic

## Verification

1. `npm run build` — TypeScript compiles without errors
2. `npm run lint` — no ESLint violations
3. `npm test` — all existing tests pass (converted to TS)
4. `docker compose build` — multi-stage build succeeds
5. `docker compose up` — service starts, `/health` endpoint responds
