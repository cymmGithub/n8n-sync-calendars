# TypeScript Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the sync-calendars JavaScript project to TypeScript with full strict mode, clean module structure, and modern tooling.

**Architecture:** Big-bang rewrite — create all TypeScript source files in `src/`, convert tests, then delete original JS files. The codebase is ~1,500 lines across 4 source files with a test suite to validate correctness.

**Tech Stack:** TypeScript (strict), Zod, date-fns, ts-jest, ESLint + Prettier, multi-stage Docker with tini

**Design doc:** `docs/plans/2026-02-28-ts-migration-design.md`

---

### Task 1: Infrastructure Setup

**Files:**
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `.prettierrc`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `.husky/pre-commit`

**Step 1: Install dependencies**

```bash
npm install typescript zod date-fns
npm install -D ts-jest @types/express @types/node eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser prettier eslint-config-prettier
npm uninstall moment
```

**Step 2: Create `tsconfig.json`**

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

**Step 3: Create `.prettierrc`**

```json
{
  "useTabs": true,
  "singleQuote": true,
  "trailingComma": "all"
}
```

**Step 4: Create `eslint.config.mjs`**

```javascript
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: ['dist/', 'coverage/', 'node_modules/', 'jest.config.ts', 'eslint.config.mjs'],
  },
);
```

**Step 5: Update `.gitignore`**

Add these lines:
```
/dist
```

**Step 6: Update `package.json` scripts**

Replace the `scripts` section:
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

Also update `"main"` to `"dist/server.js"`.

**Step 7: Update `.husky/pre-commit`**

```bash
#!/bin/sh
npm run lint && npm run test
```

**Step 8: Commit**

```bash
git add tsconfig.json eslint.config.mjs .prettierrc package.json package-lock.json .gitignore .husky/pre-commit
git commit -m "Add TypeScript, ESLint, and Prettier infrastructure"
```

---

### Task 2: Type Definitions

**Files:**
- Create: `src/types/index.ts`

**Step 1: Create the shared type definitions**

Reference the current data shapes in:
- `utils.js:265-444` — BrowserPool fields
- `utils.js:450-747` — ProxyManager fields
- `routes/oponeo-scraper.js:131-350` — mutator/obliterator request/response shapes
- `utils.js:68-106` — scrape_reservations_list return shape
- `utils.js:178-222` — scrape_reservation_details return shape

```typescript
import type { Browser, BrowserContext, Page } from 'playwright';

// .NET tick conversion constants
export const TICKS_PER_MILLISECOND = 10_000;
export const EPOCH_TICKS_AT_UNIX_EPOCH = 621_355_968_000_000_000;

// Proxy system
export interface Proxy {
  ip: string;
  port: string;
}

export interface ProxyCredentials {
  username: string;
  password: string;
}

export interface ProxyList {
  proxies: Proxy[];
  credentials: ProxyCredentials | null;
}

export interface ProxyResult {
  server: string;
  username: string;
  password: string;
  account: number;
}

// Browser pool
export interface BrowserContextResult {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  isAuthenticated: boolean;
}

// Oponeo scraping
export interface ReservationListItem {
  reservation_url: string | null;
  reservation_number: string;
}

export interface ReservationDetails {
  reservation_number: string;
  date: string;
  time: string;
  position: string;
  description: string | null;
  client_name: string;
  phone: string;
  registration_number: string;
  email: string;
}

export interface PaginationStats {
  total_pages: number;
  filtered_count: number;
  pages_processed: number;
}

export interface PaginatedReservations {
  reservations: ReservationListItem[];
  stats: PaginationStats;
}

// Route request/response types
export interface MutatorReservation {
  startDate: number | bigint;
  endDate: number | bigint;
  licencePlate?: string;
  phoneNumber?: string;
}

export interface MutatorResult {
  index: number;
  success: boolean;
  reservation: MutatorReservation;
  reservationId?: string;
  message: string;
  licencePlate: string;
  phoneNumber: string;
  startTime: string;
  endTime: string;
  error?: string;
  timestamp?: string;
}

export interface ObliteratorResult {
  index: number;
  success: boolean;
  oponeoReservationId: string;
  message?: string;
  error?: string;
  timestamp: string;
}

export interface OperationSummary {
  total: number;
  successful: number;
  failed: number;
  success_rate: string;
}
```

**Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: PASS (no source files import it yet, so no errors)

**Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "Add shared TypeScript type definitions"
```

---

### Task 3: Config & Logger

**Files:**
- Create: `src/config/env.ts`
- Create: `src/utils/logger.ts`

**Step 1: Create `src/config/env.ts`**

Reference: `utils.js:450-489` for dynamic WEBSHARE_ACCOUNT detection, `.env.example` for all known vars.

```typescript
import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  OPONEO_BASE_URL: z.string().url(),
  OPONEO_LOGIN_URL: z.string().url(),
  OPONEO_RESERVATIONS_LIST_URL: z.string().url(),
  OPONEO_EMAIL: z.string().min(1),
  OPONEO_PASSWORD: z.string().min(1),
  WO_API_KEY: z.string().optional(),
  PROXY_BLACKLIST: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

// Dynamic extraction for WEBSHARE_ACCOUNT_* environment variables
export function extractWebshareAccounts(): Map<number, string> {
  const accounts = new Map<number, string>();
  let accountNum = 1;

  while (process.env[`WEBSHARE_ACCOUNT_${accountNum}`]) {
    accounts.set(
      accountNum,
      process.env[`WEBSHARE_ACCOUNT_${accountNum}`] as string,
    );
    accountNum++;
  }

  return accounts;
}

export const webshareAccounts = extractWebshareAccounts();
```

**Step 2: Create `src/utils/logger.ts`**

Reference: `utils.js:15-29`

```typescript
import winston from 'winston';

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});
```

**Step 3: Verify compilation**

```bash
npx tsc --noEmit
```

Expected: PASS

**Step 4: Commit**

```bash
git add src/config/env.ts src/utils/logger.ts
git commit -m "Add Zod env validation and Winston logger"
```

---

### Task 4: Date Utilities

**Files:**
- Create: `src/utils/dates.ts`

**Step 1: Create `src/utils/dates.ts`**

Reference: `utils.js:32-38,224-262,810-827` — all date/time functions. Replace `moment` usage with native Date UTC operations.

```typescript
import { TICKS_PER_MILLISECOND, EPOCH_TICKS_AT_UNIX_EPOCH } from '../types/index.js';

export const getCurrentDate = (): string => {
  return new Date().toISOString().split('T')[0];
};

export const getCurrentDateMidnight = (): string => {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString();
};

export const convertTicksToDate = (ticks: bigint | number): Date => {
  const milliseconds = Number(
    (BigInt(ticks) - BigInt(EPOCH_TICKS_AT_UNIX_EPOCH)) /
      BigInt(TICKS_PER_MILLISECOND),
  );
  return new Date(milliseconds);
};

export const formatTime = (date: Date): string => {
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

export function isoToTicks(isoString: string): bigint {
  const cleanIsoString = isoString.replace(/[+-]\d{2}:\d{2}$|Z$/, '');
  const date = new Date(cleanIsoString);

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ISO string: ${isoString}`);
  }

  const ms = BigInt(date.getTime());
  return ms * BigInt(TICKS_PER_MILLISECOND) + BigInt(EPOCH_TICKS_AT_UNIX_EPOCH);
}

export const getTimeSlotIndex = (timeString: string | null | undefined, date: Date | null | undefined): number => {
  if (!timeString || !date) {
    throw new Error('Both timeString and date are required');
  }

  if (timeString === '17:00') {
    return 0;
  }

  if (timeString === '14:00' && date.getDay() === 6) {
    return 0;
  }

  return 1;
};

export const getReservationsFromNowUrl = (): string => {
  const reservationsBaseUrl = process.env['OPONEO_RESERVATIONS_LIST_URL'];
  const jsNow = new Date();
  const dotNetNow =
    jsNow.getTime() * TICKS_PER_MILLISECOND + EPOCH_TICKS_AT_UNIX_EPOCH;

  return `${reservationsBaseUrl}?data-od=${dotNetNow}`;
};
```

Note: `getReservationsFromNowUrl` still uses `process.env` directly because it references `OPONEO_RESERVATIONS_LIST_URL` which is already validated at startup via env.ts. Alternatively, import `env` — decide based on whether the scraper module needs the env import anyway.

**Step 2: Verify compilation**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/utils/dates.ts
git commit -m "Add typed date/time utility functions"
```

---

### Task 5: Browser Utilities

**Files:**
- Create: `src/utils/browser.ts`

**Step 1: Create `src/utils/browser.ts`**

Reference: `utils.js:752-808` — createBrowserInstance, createBrowserContext, randomDelay. Note: this file imports `proxyManager` singleton, so use a lazy import or accept the circular reference by importing from the service.

```typescript
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page } from 'playwright';
import { logger } from './logger.js';
import { proxyManager } from '../services/proxy-manager.js';

chromium.use(stealth());

export async function createBrowserInstance(
  debugMode = false,
): Promise<Browser> {
  const proxy = await proxyManager.getRandomProxy();

  const browserOptions = {
    headless: !debugMode,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-ipc-flooding-protection',
    ],
    proxy: {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password,
    },
  };

  const browser = await chromium.launch(browserOptions);
  logger.info('Browser instance created successfully');

  return browser;
}

export async function createBrowserContext(
  browser: Browser,
  debugMode = false,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
  });

  const page = await context.newPage();

  if (debugMode) {
    page.on('console', (msg) => console.log('Browser console:', msg.text()));
    page.on('pageerror', (err) => console.error('Browser page error:', err));
  }

  return { context, page };
}

export const randomDelay = (min = 100, max = 300): Promise<void> => {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.random() * (max - min) + min),
  );
};
```

**Step 2: This file depends on `proxy-manager.ts` which hasn't been created yet. It will compile after Task 6. Skip verification for now.**

**Step 3: Commit**

```bash
git add src/utils/browser.ts
git commit -m "Add typed browser creation utilities"
```

---

### Task 6: Services — ProxyManager

**Files:**
- Create: `src/services/proxy-manager.ts`

**Step 1: Create `src/services/proxy-manager.ts`**

Reference: `utils.js:450-750` — full ProxyManager class. Convert to TypeScript with private fields, typed methods.

Key changes from JS:
- All fields get explicit types and visibility modifiers
- `proxyLists` typed as `Record<string, ProxyList>`
- `ipUsageCount` typed as `Map<string, number>`
- `fetchProxyList` uses native `fetch` instead of `http`/`https` modules (Node 18+ has global fetch)
- Import types from `../types/index.js`

```typescript
import http from 'node:http';
import https from 'node:https';
import { logger } from '../utils/logger.js';
import type { Proxy, ProxyCredentials, ProxyList, ProxyResult } from '../types/index.js';

export class ProxyManager {
  private availableAccounts: number[];
  private proxyLists: Record<string, ProxyList>;
  private ipUsageCount: Map<string, number>;
  private currentThreshold: number;
  private lastUsedAccount: number | null;
  private lastUsedIP: string | null;
  private lastFetch: number | null;
  private readonly CACHE_TTL = 60 * 60 * 1000;
  private blacklistedIPs: Set<string>;

  constructor() {
    this.availableAccounts = this.detectAvailableAccounts();
    this.proxyLists = {};

    for (const accountNum of this.availableAccounts) {
      this.proxyLists[`account${accountNum}`] = {
        proxies: [],
        credentials: null,
      };
    }

    this.ipUsageCount = new Map();
    this.currentThreshold = 10;
    this.lastUsedAccount = null;
    this.lastUsedIP = null;
    this.lastFetch = null;
    this.blacklistedIPs = new Set();
    this.loadBlacklist();

    logger.info(
      `ProxyManager initialized with ${this.availableAccounts.length} accounts: ${this.availableAccounts.join(', ')}`,
    );
  }

  private detectAvailableAccounts(): number[] {
    const accounts: number[] = [];
    let accountNum = 1;

    while (process.env[`WEBSHARE_ACCOUNT_${accountNum}`]) {
      accounts.push(accountNum);
      accountNum++;
    }

    if (accounts.length === 0) {
      logger.warn('No WEBSHARE_ACCOUNT_* environment variables found');
    }

    return accounts;
  }

  loadBlacklist(): void {
    const blacklistEnv = process.env['PROXY_BLACKLIST'];
    if (!blacklistEnv) {
      logger.info('No proxy blacklist configured');
      return;
    }

    const blacklistedItems = blacklistEnv
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item);

    this.blacklistedIPs = new Set(blacklistedItems);

    logger.info(
      `Loaded ${this.blacklistedIPs.size} blacklisted IPs/ports: ${Array.from(this.blacklistedIPs).join(', ')}`,
    );
  }

  isBlacklisted(ipPort: string): boolean {
    if (this.blacklistedIPs.has(ipPort)) {
      return true;
    }

    const ip = ipPort.split(':')[0];
    return this.blacklistedIPs.has(ip);
  }

  async fetchProxyList(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;

      protocol
        .get(url, (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on('end', () => {
            resolve(data);
          });
        })
        .on('error', (err: Error) => {
          reject(err);
        });
    });
  }

  parseProxyList(data: string): ProxyList {
    const lines = data.trim().split('\n');
    const proxies: Proxy[] = [];
    let credentials: ProxyCredentials | null = null;

    for (const line of lines) {
      const parts = line.trim().split(':');
      if (parts.length === 4) {
        const [ip, port, username, password] = parts;
        proxies.push({ ip, port });
        if (!credentials) {
          credentials = { username, password };
        }
      }
    }

    return { proxies, credentials };
  }

  async refreshProxyLists(): Promise<boolean> {
    try {
      logger.info(
        `Fetching proxy lists from ${this.availableAccounts.length} Webshare accounts...`,
      );

      const fetchPromises = this.availableAccounts.map((accountNum) =>
        this.fetchProxyList(
          process.env[`WEBSHARE_ACCOUNT_${accountNum}`] as string,
        ),
      );

      const dataList = await Promise.all(fetchPromises);

      const accountStats: string[] = [];
      for (let i = 0; i < this.availableAccounts.length; i++) {
        const accountNum = this.availableAccounts[i];
        const parsed = this.parseProxyList(dataList[i]);
        this.proxyLists[`account${accountNum}`] = parsed;
        accountStats.push(`Account${accountNum}=${parsed.proxies.length} IPs`);
      }

      this.lastFetch = Date.now();
      logger.info(`Proxy lists refreshed: ${accountStats.join(', ')}`);

      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to refresh proxy lists: ${message}`);

      const firstAccount = this.availableAccounts[0];
      if (
        firstAccount &&
        this.proxyLists[`account${firstAccount}`]?.proxies.length > 0
      ) {
        logger.warn('Using cached proxy lists');
        return false;
      }
      throw error;
    }
  }

  private needsRefresh(): boolean {
    if (!this.lastFetch) return true;
    return Date.now() - this.lastFetch > this.CACHE_TTL;
  }

  getAllUniqueIPs(): Proxy[] {
    const ipSet = new Set<string>();
    const ipList: Proxy[] = [];

    for (const accountNum of this.availableAccounts) {
      const accountKey = `account${accountNum}`;
      const accountData = this.proxyLists[accountKey];

      if (!accountData?.proxies) {
        continue;
      }

      for (const proxy of accountData.proxies) {
        const ipPort = `${proxy.ip}:${proxy.port}`;
        if (!ipSet.has(ipPort) && !this.isBlacklisted(ipPort)) {
          ipSet.add(ipPort);
          ipList.push(proxy);
        }
      }
    }

    return ipList;
  }

  async getRandomProxy(): Promise<ProxyResult> {
    if (this.needsRefresh()) {
      await this.refreshProxyLists();
    }

    const allIPs = this.getAllUniqueIPs();

    if (allIPs.length === 0) {
      throw new Error('No proxies available');
    }

    let nextAccount: number;
    if (this.lastUsedAccount === null) {
      nextAccount = this.availableAccounts[0];
    } else {
      const currentIndex = this.availableAccounts.indexOf(this.lastUsedAccount);
      const nextIndex = (currentIndex + 1) % this.availableAccounts.length;
      nextAccount = this.availableAccounts[nextIndex];
    }
    this.lastUsedAccount = nextAccount;

    const accountKey = `account${nextAccount}`;
    const credentials = this.proxyLists[accountKey]?.credentials;

    if (!credentials) {
      throw new Error(`No credentials available for ${accountKey}`);
    }

    let availableIPs = allIPs.filter((proxy) => {
      const ipPort = `${proxy.ip}:${proxy.port}`;
      const usage = this.ipUsageCount.get(ipPort) ?? 0;
      return usage < this.currentThreshold;
    });

    while (availableIPs.length === 0) {
      this.currentThreshold += 10;
      logger.warn(
        `All IPs exhausted at previous threshold. Increasing to ${this.currentThreshold}`,
      );

      availableIPs = allIPs.filter((proxy) => {
        const ipPort = `${proxy.ip}:${proxy.port}`;
        const usage = this.ipUsageCount.get(ipPort) ?? 0;
        return usage < this.currentThreshold;
      });
    }

    if (this.lastUsedIP && availableIPs.length > 1) {
      availableIPs = availableIPs.filter((proxy) => {
        const ipPort = `${proxy.ip}:${proxy.port}`;
        return ipPort !== this.lastUsedIP;
      });
    }

    const selectedProxy =
      availableIPs[Math.floor(Math.random() * availableIPs.length)];
    const selectedIPPort = `${selectedProxy.ip}:${selectedProxy.port}`;

    const currentUsage = this.ipUsageCount.get(selectedIPPort) ?? 0;
    this.ipUsageCount.set(selectedIPPort, currentUsage + 1);

    this.lastUsedIP = selectedIPPort;

    logger.info(
      `Proxy selected: ${selectedIPPort} (Account ${nextAccount}, Usage: ${currentUsage + 1}/${this.currentThreshold})`,
    );

    this.logUsageStats();

    return {
      server: selectedIPPort,
      username: credentials.username,
      password: credentials.password,
      account: nextAccount,
    };
  }

  private logUsageStats(): void {
    const stats: {
      totalIPs: number;
      threshold: number;
      usageDistribution: Record<string, number>;
    } = {
      totalIPs: this.ipUsageCount.size,
      threshold: this.currentThreshold,
      usageDistribution: {},
    };

    for (const [, count] of this.ipUsageCount.entries()) {
      const bucket = Math.floor(count / 10) * 10;
      const key = `${bucket}-${bucket + 9}`;
      stats.usageDistribution[key] = (stats.usageDistribution[key] ?? 0) + 1;
    }

    logger.info(`Proxy usage stats: ${JSON.stringify(stats)}`);
  }
}

export const proxyManager = new ProxyManager();
```

**Step 2: Verify compilation**

```bash
npx tsc --noEmit
```

Expected: Should compile now that proxy-manager exists (browser.ts depends on it).

**Step 3: Commit**

```bash
git add src/services/proxy-manager.ts
git commit -m "Add typed ProxyManager service"
```

---

### Task 7: Services — BrowserPool

**Files:**
- Create: `src/services/browser-pool.ts`

**Step 1: Create `src/services/browser-pool.ts`**

Reference: `utils.js:265-447` — full BrowserPool class. Convert with private fields, typed methods, `NodeJS.Timeout` for timer types.

```typescript
import type { Browser, BrowserContext, Page } from 'playwright';
import { logger } from '../utils/logger.js';
import {
  createBrowserInstance,
  createBrowserContext,
} from '../utils/browser.js';
import type { BrowserContextResult } from '../types/index.js';

export class BrowserPool {
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
  isAuthenticated: boolean;
  lastUsed: number | null;
  isInUse: boolean;
  readonly IDLE_TIMEOUT = 5 * 60 * 1000;
  private contextCleanupTimer: ReturnType<typeof setTimeout> | null;
  private browserCleanupTimer: ReturnType<typeof setTimeout> | null;

  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isAuthenticated = false;
    this.lastUsed = null;
    this.isInUse = false;
    this.contextCleanupTimer = null;
    this.browserCleanupTimer = null;
  }

  async getBrowser(debugMode = false): Promise<Browser> {
    if (this.browser && !this.isStale()) {
      logger.info('Reusing existing browser instance');
      this.isInUse = true;
      this.lastUsed = Date.now();
      return this.browser;
    }

    if (this.browser) {
      logger.info('Closing stale browser instance');
      await this.closeBrowser();
    }

    logger.info('Creating new browser instance');
    this.browser = await createBrowserInstance(debugMode);
    this.isInUse = true;
    this.lastUsed = Date.now();
    return this.browser;
  }

  async getContext(debugMode = false): Promise<BrowserContextResult> {
    if (this.context && this.page && !this.isStale()) {
      logger.info('Reusing existing context and page', {
        authenticated: this.isAuthenticated,
      });
      this.isInUse = true;
      this.lastUsed = Date.now();
      return {
        browser: this.browser!,
        context: this.context,
        page: this.page,
        isAuthenticated: this.isAuthenticated,
      };
    }

    if (this.context) {
      logger.info('Closing stale context');
      await this.closeContext();
    }

    const browser = await this.getBrowser(debugMode);

    logger.info('Creating new context and page');
    const { context, page } = await createBrowserContext(browser, debugMode);
    this.context = context;
    this.page = page;
    this.isAuthenticated = false;
    this.isInUse = true;
    this.lastUsed = Date.now();

    return {
      browser: this.browser!,
      context: this.context,
      page: this.page,
      isAuthenticated: this.isAuthenticated,
    };
  }

  markAsAuthenticated(): void {
    this.isAuthenticated = true;
    logger.info('Context marked as authenticated');
  }

  async releaseContext(): Promise<void> {
    this.isInUse = false;
    this.lastUsed = Date.now();

    logger.info('Context released, will cleanup after idle timeout');

    if (this.contextCleanupTimer) {
      clearTimeout(this.contextCleanupTimer);
    }

    this.contextCleanupTimer = setTimeout(async () => {
      if (!this.isInUse && this.isStale()) {
        logger.info('Closing idle context and browser');
        await this.closeContext();
        await this.closeBrowser();
      }
    }, this.IDLE_TIMEOUT);
  }

  async releaseBrowser(): Promise<void> {
    this.isInUse = false;
    this.lastUsed = Date.now();

    if (this.browserCleanupTimer) {
      clearTimeout(this.browserCleanupTimer);
    }

    this.browserCleanupTimer = setTimeout(async () => {
      if (!this.isInUse && this.isStale()) {
        logger.info('Closing idle browser instance');
        await this.closeBrowser();
      }
    }, this.IDLE_TIMEOUT);
  }

  isStale(): boolean {
    if (!this.lastUsed) return false;
    return Date.now() - this.lastUsed > this.IDLE_TIMEOUT;
  }

  async closeContext(): Promise<void> {
    if (this.contextCleanupTimer) {
      clearTimeout(this.contextCleanupTimer);
      this.contextCleanupTimer = null;
    }

    if (this.context) {
      try {
        await this.context.close();
        logger.info('Context closed successfully');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error closing context: ${message}`);
      }
      this.context = null;
      this.page = null;
      this.isAuthenticated = false;
    }
  }

  async closeBrowser(): Promise<void> {
    if (this.browserCleanupTimer) {
      clearTimeout(this.browserCleanupTimer);
      this.browserCleanupTimer = null;
    }

    await this.closeContext();

    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error closing browser: ${message}`);
      }
      this.browser = null;
      this.isInUse = false;
      this.lastUsed = null;
    }
  }

  clearTimers(): void {
    if (this.contextCleanupTimer) {
      clearTimeout(this.contextCleanupTimer);
      this.contextCleanupTimer = null;
    }
    if (this.browserCleanupTimer) {
      clearTimeout(this.browserCleanupTimer);
      this.browserCleanupTimer = null;
    }
  }
}

export const browserPool = new BrowserPool();
```

**Step 2: Verify compilation**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/services/browser-pool.ts
git commit -m "Add typed BrowserPool service"
```

---

### Task 8: Oponeo Scraper Functions

**Files:**
- Create: `src/scrapers/oponeo.ts`

**Step 1: Create `src/scrapers/oponeo.ts`**

Reference: `utils.js:41-234` — authenticate_oponeo, scrape_reservations_list, get_all_pages_reservations, scrape_reservation_details, get_reservations_from_now_url.

Convert all functions with typed parameters and return types. The `page.evaluate()` callbacks run in browser context and cannot be typed with our interfaces directly — they return plain objects that match our interface shapes.

```typescript
import type { Page } from 'playwright';
import { logger } from '../utils/logger.js';
import { TICKS_PER_MILLISECOND, EPOCH_TICKS_AT_UNIX_EPOCH } from '../types/index.js';
import type {
  ReservationListItem,
  ReservationDetails,
  PaginatedReservations,
} from '../types/index.js';

export async function authenticateOponeo(
  page: Page,
  email: string,
  password: string,
): Promise<boolean> {
  try {
    await page.goto(process.env['OPONEO_LOGIN_URL']!, {
      waitUntil: 'load',
      timeout: 60000,
    });

    await page.fill('input[name="Login"]', email);
    await page.fill('input[name="Password"]', password);

    await Promise.all([
      page.click('a.button.enter', { timeout: 60000 }),
      page.waitForNavigation({ waitUntil: 'load', timeout: 60000 }),
    ]);

    const currentUrl = page.url();
    if (currentUrl.includes('logowanie')) {
      throw new Error('Login failed - still on login page');
    }

    logger.info('Successfully logged in to Oponeo');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Authentication failed: ${message}`);
    throw error;
  }
}

export async function scrapeReservationsList(
  page: Page,
): Promise<ReservationListItem[]> {
  try {
    const reservations = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.table .row'));
      return rows
        .map((row) => {
          const reservationNumber = row
            .querySelector('.reservationNumber .content')
            ?.textContent?.trim();
          const licencePlate = row
            .querySelector('.registrationNumber .content')
            ?.textContent?.trim();

          if (
            !licencePlate?.startsWith('KAKTUSXXX') &&
            !reservationNumber?.startsWith('R')
          ) {
            return null;
          }

          return {
            reservation_url:
              row.querySelector<HTMLAnchorElement>('a.reservationNumber')
                ?.href ?? null,
            reservation_number: reservationNumber ?? '',
          };
        })
        .filter(
          (reservation): reservation is NonNullable<typeof reservation> =>
            reservation !== null,
        );
    });

    logger.info(
      `Found ${reservations.length} reservations starting with 'R' on current page`,
    );
    return reservations;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Error scraping reservations list: ${message}`);
    throw error;
  }
}

export async function getAllPagesReservations(
  page: Page,
): Promise<PaginatedReservations> {
  try {
    const allReservations: ReservationListItem[] = [];
    let currentPage = 1;
    const reservationsFromNowUrl = getReservationsFromNowUrl();

    const totalPages = await page.evaluate(() => {
      const pagerItems = Array.from(
        document.querySelectorAll(
          '.pager li:not(:has(a[ajaxsubmit="NextPage"]))',
        ),
      );

      if (pagerItems.length === 0) {
        console.log('No pagination found, assuming single page');
        return 1;
      }

      const lastPageItem = pagerItems
        .filter((item) => /^\d+$/.test(item.textContent?.trim() ?? ''))
        .pop();

      if (!lastPageItem) {
        console.log(
          'Could not find last numeric page item, assuming single page',
        );
        return 1;
      }

      const pageText = lastPageItem.textContent?.trim() ?? '1';
      return parseInt(pageText) || 1;
    });

    logger.info(`Total pages detected: ${totalPages}`);

    logger.info(`Processing page ${currentPage}/${totalPages}`);
    const firstPageReservations = await scrapeReservationsList(page);
    allReservations.push(...firstPageReservations);

    while (currentPage < totalPages) {
      currentPage++;

      logger.info(`Navigating to page ${currentPage}/${totalPages}`);
      const nextPageUrl = `${reservationsFromNowUrl}&strona=${currentPage}`;
      await page.goto(nextPageUrl, { waitUntil: 'load' });

      logger.info(`Processing page ${currentPage}/${totalPages}`);
      const pageReservations = await scrapeReservationsList(page);
      allReservations.push(...pageReservations);
    }

    logger.info(
      `Processed ${totalPages} pages with ${allReservations.length} reservations`,
    );
    return {
      reservations: allReservations,
      stats: {
        total_pages: totalPages,
        filtered_count: allReservations.length,
        pages_processed: totalPages,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Pagination error: ${message}`);
    throw error;
  }
}

export async function scrapeReservationDetails(
  page: Page,
  reservationUrl: string,
): Promise<ReservationDetails> {
  try {
    await page.goto(reservationUrl, { waitUntil: 'load' });

    logger.info(`Processing Oponeo reservation: ${reservationUrl}`);

    const details: ReservationDetails = await page.evaluate(() => {
      const getProduktyTextContent = (): string | null => {
        const produkty = Array.from(
          document.querySelectorAll('div.title'),
        ).find((el) => el.textContent?.trim() === 'Produkty');
        if (!produkty) return null;
        const description = produkty.nextElementSibling;
        return description?.textContent?.trim() ?? null;
      };

      const getLabelsTextContent = (labelText: string): string => {
        const labels = Array.from(document.querySelectorAll('p label'));
        const label = labels.find((l) => l.textContent?.trim() === labelText);
        if (!label) return '';
        const parentP = label.closest('p');
        if (!parentP) return '';
        return parentP.textContent?.replace(labelText, '').trim() ?? '';
      };

      return {
        reservation_number: getLabelsTextContent('Numer rezerwacji:'),
        date: getLabelsTextContent('Data:'),
        time: getLabelsTextContent('Godzina:'),
        position: getLabelsTextContent('Stanowisko:'),
        description: getProduktyTextContent(),
        client_name: getLabelsTextContent('Imię i nazwisko:'),
        phone: getLabelsTextContent('Nr telefonu:'),
        registration_number: getLabelsTextContent('Nr rejestracyjny:'),
        email: getLabelsTextContent('E-mail:'),
      };
    });

    return details;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Error scraping reservation details: ${message}`);
    throw error;
  }
}

export const getReservationsFromNowUrl = (): string => {
  const reservationsBaseUrl = process.env['OPONEO_RESERVATIONS_LIST_URL'];
  const jsNow = new Date();
  const dotNetNow =
    jsNow.getTime() * TICKS_PER_MILLISECOND + EPOCH_TICKS_AT_UNIX_EPOCH;
  console.log('dot_net_now', dotNetNow);

  return `${reservationsBaseUrl}?data-od=${dotNetNow}`;
};
```

Note: Function names converted from snake_case to camelCase (TypeScript convention). The old snake_case names were kept in the JS codebase but camelCase is idiomatic TS.

**Step 2: Verify compilation**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/scrapers/oponeo.ts
git commit -m "Add typed Oponeo scraper functions"
```

---

### Task 9: Routes — WO Events

**Files:**
- Create: `src/routes/wo-events.ts`

**Step 1: Create `src/routes/wo-events.ts`**

Reference: `routes/wo-events.js:1-106`. Straightforward conversion — add types to request handlers.

```typescript
import { Router } from 'express';
import type { Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { getCurrentDate, getCurrentDateMidnight } from '../utils/dates.js';

const router = Router();

router.get('/events', async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info('Work order events endpoint called');

    const page = (req.query['page'] as string) ?? '1';
    const itemsPerPage = (req.query['itemsPerPage'] as string) ?? '100';

    let dateFrom: string | undefined;
    let updatedAtFrom: string | undefined;

    if (req.query['filter_by'] === 'date_from') {
      dateFrom = getCurrentDate();
    }

    if (req.query['filter_by'] === 'updated_at_from') {
      updatedAtFrom = getCurrentDateMidnight();
    }

    if (!process.env['WO_API_KEY']) {
      logger.error('WO_API_KEY environment variable is not set');
      res.status(500).json({
        success: false,
        error: 'API configuration error',
        details: 'WO_API_KEY is not configured',
      });
      return;
    }

    const woApiUrl = new URL(
      'https://api.wymianaopon.pl/api/events/planned',
    );
    woApiUrl.searchParams.set('page', page);
    woApiUrl.searchParams.set('itemsPerPage', itemsPerPage);

    if (dateFrom) {
      woApiUrl.searchParams.set('date_from', dateFrom);
    }
    if (updatedAtFrom) {
      woApiUrl.searchParams.set('updated_at_from', updatedAtFrom);
    }

    logger.info(`Fetching WO events from: ${woApiUrl.toString()}`);

    const response = await fetch(woApiUrl.toString(), {
      method: 'GET',
      headers: {
        accept: '*/*',
        Authorization: `Bearer ${process.env['WO_API_KEY']}`,
      },
    });

    if (!response.ok) {
      logger.error(
        `WO API request failed with status: ${response.status}`,
      );
      const errorText = await response.text();
      logger.error(`WO API error response: ${errorText}`);

      res.status(response.status).json({
        success: false,
        error: `WO API request failed with status ${response.status}`,
        details: errorText,
      });
      return;
    }

    const woData: unknown = await response.json();
    const dataLength =
      Array.isArray(woData) ? woData.length : 'unknown';
    logger.info(
      `Successfully fetched ${dataLength} events from WO API`,
    );

    res.json({
      success: true,
      data: woData,
      metadata: {
        source: 'WO API',
        timestamp: new Date().toISOString(),
        parameters: {
          page: parseInt(page),
          itemsPerPage: parseInt(itemsPerPage),
          ...(dateFrom && { date_from: dateFrom }),
          ...(updatedAtFrom && { updated_at_from: updatedAtFrom }),
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const stack = error instanceof Error ? error.stack : undefined;
    logger.error('Error in work order events endpoint', {
      error: message,
      stack,
    });

    res.status(500).json({
      success: false,
      error: message,
      details: 'An error occurred while fetching work order events',
    });
  }
});

export default router;
```

**Step 2: Verify compilation**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/routes/wo-events.ts
git commit -m "Add typed WO events route"
```

---

### Task 10: Routes — Oponeo Scraper

**Files:**
- Create: `src/routes/oponeo-scraper.ts`

**Step 1: Create `src/routes/oponeo-scraper.ts`**

Reference: `routes/oponeo-scraper.js:1-492`. Largest route file with three endpoints. Import from new module locations. Use camelCase function names.

This file is long — the key changes from JS are:
- Import from new module paths (`../scrapers/oponeo.js`, `../services/browser-pool.js`, etc.)
- Function names: `authenticate_oponeo` → `authenticateOponeo`, `get_all_pages_reservations` → `getAllPagesReservations`, etc.
- Type annotations on request handlers: `(req: Request, res: Response): Promise<void>`
- Type the `reservations` body parameter in mutator: `MutatorReservation[]`
- Type `results` and `errors` arrays with `MutatorResult[]` / `ObliteratorResult[]`
- Use `error instanceof Error` guards for catch blocks
- `return` after `res.status().send/json()` to satisfy void return (or use `as void`)

The full implementation follows the exact same logic as the JS version, just with types added. Preserve all business logic unchanged.

**Step 2: Verify compilation**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/routes/oponeo-scraper.ts
git commit -m "Add typed Oponeo scraper routes"
```

---

### Task 11: Server Entry Point

**Files:**
- Create: `src/server.ts`

**Step 1: Create `src/server.ts`**

Reference: `server.js:1-57`. Import from new module paths. The `dotenv/config` import moves to `env.ts` (already imported there).

```typescript
import express from 'express';
import { env } from './config/env.js';
import scraperRoutes from './routes/oponeo-scraper.js';
import eventsRoutes from './routes/wo-events.js';

const app = express();

app.use(express.json());

app.use('/oponeo', scraperRoutes);
app.use('/wo', eventsRoutes);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

const server = app.listen(env.PORT, () => {
  console.log(`Scraper is running on http://localhost:${env.PORT}`);
});

const shutdown = (): void => {
  server.close((err) => {
    console.log('Shutting down the server...');
    if (err) {
      console.error('Error during server shutdown:', err);
      process.exitCode = 1;
    }
    process.exit();
  });
};

process.on('SIGINT', () => {
  console.info(
    'Got SIGINT (aka ctrl-c in docker). Graceful shutdown',
    new Date().toISOString(),
  );
  shutdown();
});

process.on('SIGTERM', () => {
  console.info(
    'Got SIGTERM (docker container stop). Graceful shutdown',
    new Date().toISOString(),
  );
  shutdown();
});
```

**Step 2: Verify full compilation**

```bash
npx tsc
```

Expected: Compiles successfully, `dist/` directory created with all JS output.

**Step 3: Commit**

```bash
git add src/server.ts
git commit -m "Add typed server entry point"
```

---

### Task 12: Jest Configuration

**Files:**
- Create: `jest.config.ts`

**Step 1: Create `jest.config.ts`**

```typescript
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.ts', '!src/types/**'],
  testTimeout: 10000,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  transformIgnorePatterns: ['node_modules/(?!(jsdom|parse5)/)'],
};

export default config;
```

**Step 2: Commit**

```bash
git add jest.config.ts
git commit -m "Add ts-jest configuration"
```

---

### Task 13: Unit Tests — Dates

**Files:**
- Create: `tests/unit/dates.test.ts`

**Step 1: Create `tests/unit/dates.test.ts`**

Reference: `tests/unit/utils.test.js:1-304` — extract all date/time tests. Key changes:
- Import from `../../src/utils/dates.js` and `../../src/types/index.js`
- Remove all `moment` imports — replace with native Date operations
- The test `should match moment.utc().startOf('day').toISOString()` becomes a native UTC midnight check
- The test `should return time exactly 24 hours before tomorrow's midnight` uses native Date arithmetic

Replace the `moment` comparison test:
```typescript
it('should return UTC midnight for today', () => {
  const result = getCurrentDateMidnight();
  const expected = new Date();
  expected.setUTCHours(0, 0, 0, 0);
  expect(result).toBe(expected.toISOString());
});
```

Replace the `moment.utc().add(1, 'day')` test:
```typescript
it("should return time exactly 24 hours before tomorrow's midnight", () => {
  const today = getCurrentDateMidnight();
  const tomorrow = new Date();
  tomorrow.setUTCHours(0, 0, 0, 0);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const todayTime = new Date(today).getTime();
  const tomorrowTime = tomorrow.getTime();

  expect(tomorrowTime - todayTime).toBe(24 * 60 * 60 * 1000);
});
```

All other tests remain logically identical, just with updated imports and the `getReservationsFromNowUrl` function name changed to camelCase.

Also include the `getReservationsFromNowUrl` tests from the original file (lines 218-261) — these reference `OPONEO_RESERVATIONS_LIST_URL` env var. Keep the `beforeEach`/`afterEach` env setup.

**Step 2: Run tests to verify they pass**

```bash
npx jest tests/unit/dates.test.ts --verbose
```

Expected: All tests PASS

**Step 3: Commit**

```bash
git add tests/unit/dates.test.ts
git commit -m "Add typed date utility tests"
```

---

### Task 14: Unit Tests — ProxyManager

**Files:**
- Create: `tests/unit/proxy-manager.test.ts`

**Step 1: Create `tests/unit/proxy-manager.test.ts`**

Reference: `tests/unit/utils.test.js:638-978` — extract all ProxyManager tests. Key changes:
- Import `proxyManager` from `../../src/services/proxy-manager.js`
- Type-safe mock assertions where applicable
- Keep the `beforeEach` state reset pattern — access public fields on the singleton

All test logic remains identical. The ProxyManager fields accessed in tests (`availableAccounts`, `proxyLists`, `lastFetch`, `ipUsageCount`, `currentThreshold`, `lastUsedAccount`, `lastUsedIP`, `blacklistedIPs`) need to be public or accessed via test-specific methods. In the current design they are public on the class, which is fine for testing.

**Step 2: Run tests**

```bash
npx jest tests/unit/proxy-manager.test.ts --verbose
```

Expected: All tests PASS

**Step 3: Commit**

```bash
git add tests/unit/proxy-manager.test.ts
git commit -m "Add typed ProxyManager tests"
```

---

### Task 15: Unit Tests — BrowserPool

**Files:**
- Create: `tests/unit/browser-pool.test.ts`

**Step 1: Create `tests/unit/browser-pool.test.ts`**

Reference: `tests/unit/utils.test.js:506-636` — extract BrowserPool unit tests. Key changes:
- Import `browserPool` from `../../src/services/browser-pool.js`
- Type mock objects: `{ close: jest.fn() }` needs to satisfy the `BrowserContext` interface partially — use type assertions: `browserPool.context = { close: jest.fn() } as unknown as BrowserContext`

**Step 2: Run tests**

```bash
npx jest tests/unit/browser-pool.test.ts --verbose
```

Expected: All tests PASS

**Step 3: Commit**

```bash
git add tests/unit/browser-pool.test.ts
git commit -m "Add typed BrowserPool tests"
```

---

### Task 16: Integration Tests

**Files:**
- Create: `tests/integration/wo-events.test.ts`
- Create: `tests/integration/context-sharing.test.ts`

**Step 1: Create `tests/integration/wo-events.test.ts`**

Reference: `tests/integration/wo-events.test.js`. Key changes:
- Mock path changes: `jest.mock('../../src/utils/logger.js', ...)` and `jest.mock('../../src/utils/dates.js', ...)`
- Router import: `require('../../src/routes/wo-events.js')`
- Type-safe fetch mock:
```typescript
global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
  ok: true,
  json: async () => mockEventsData,
} as Response);
```

Note: The `jest.resetModules()` + `require()` pattern in the original test will need to stay as `require()` rather than static `import` since it's dynamic. Use `// eslint-disable-next-line` for the require calls, or restructure with `jest.unstable_mockModule` if using ESM.

Since `ts-jest` with `Node16` modules likely uses CJS transform, the `require()` pattern should work. Type the require result:
```typescript
const woEventsRouter = require('../../src/routes/wo-events.js').default as Router;
```

**Step 2: Create `tests/integration/context-sharing.test.ts`**

Reference: `tests/integration/context-sharing.test.js`. Key changes:
- Import from `../../src/services/browser-pool.js`
- Type mock objects with assertions:
```typescript
import type { Browser, BrowserContext, Page } from 'playwright';

const mockPage = { goto: jest.fn(), fill: jest.fn(), click: jest.fn(), url: jest.fn(() => 'https://example.com') } as unknown as Page;
const mockContext = { close: jest.fn(), newPage: jest.fn().mockResolvedValue(mockPage) } as unknown as BrowserContext;
const mockBrowser = { close: jest.fn(), newContext: jest.fn().mockResolvedValue(mockContext) } as unknown as Browser;
```

**Step 3: Run integration tests**

```bash
npx jest tests/integration --verbose
```

Expected: All tests PASS

**Step 4: Commit**

```bash
git add tests/integration/wo-events.test.ts tests/integration/context-sharing.test.ts
git commit -m "Add typed integration tests"
```

---

### Task 17: Functional Tests

**Files:**
- Create: `tests/functional/scraper-functions.test.ts`

**Step 1: Create `tests/functional/scraper-functions.test.ts`**

Reference: `tests/functional/scraper-functions.test.js`. Key changes:
- Import from `../../src/scrapers/oponeo.js` — function names now camelCase: `scrapeReservationsList`, `scrapeReservationDetails`
- Type the mock page object:
```typescript
import type { Page } from 'playwright';

const createMockPage = (htmlContent: string): Page => ({
  evaluate: jest.fn(async (fn: () => unknown) => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(htmlContent, { runScripts: 'dangerously' });
    const script = `(${fn.toString()})()`;
    return dom.window.eval(script) as unknown;
  }),
  goto: jest.fn(),
} as unknown as Page);
```

**Step 2: Run functional tests**

```bash
npx jest tests/functional --verbose
```

Expected: All tests PASS

**Step 3: Run full test suite**

```bash
npm test
```

Expected: All tests PASS

**Step 4: Commit**

```bash
git add tests/functional/scraper-functions.test.ts
git commit -m "Add typed functional tests"
```

---

### Task 18: Delete Old JS Files

**Files:**
- Delete: `server.js`
- Delete: `utils.js`
- Delete: `jest.config.js`
- Delete: `routes/oponeo-scraper.js`
- Delete: `routes/wo-events.js`
- Delete: `tests/unit/utils.test.js`
- Delete: `tests/integration/wo-events.test.js`
- Delete: `tests/integration/context-sharing.test.js`
- Delete: `tests/functional/scraper-functions.test.js`

**Step 1: Delete old files**

```bash
rm server.js utils.js jest.config.js
rm routes/oponeo-scraper.js routes/wo-events.js
rmdir routes
rm tests/unit/utils.test.js
rm tests/integration/wo-events.test.js tests/integration/context-sharing.test.js
rm tests/functional/scraper-functions.test.js
```

**Step 2: Verify tests still pass**

```bash
npm test
```

Expected: All tests PASS (now running from .ts files only)

**Step 3: Verify build**

```bash
npm run build
```

Expected: Compiles successfully

**Step 4: Commit**

```bash
git add -A
git commit -m "Remove original JavaScript source files"
```

---

### Task 19: Update Docker

**Files:**
- Modify: `Dockerfile`
- Modify: `compose.yaml`

**Step 1: Update `Dockerfile` with multi-stage build + tini**

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

**Step 2: Update `compose.yaml`**

Update the `sync-service` volumes — remove the source mount for production, or adjust for dev workflow:
```yaml
sync-service:
  build:
    context: .
    dockerfile: Dockerfile
  restart: unless-stopped
  ipc: host
  init: true
  environment:
    # ... (unchanged)
  volumes:
    - ./dist:/app/dist
```

Note: The `init: true` in compose is now redundant with `tini` in the Dockerfile, but keeping both is harmless and provides defense in depth.

**Step 3: Verify Docker build**

```bash
docker compose build sync-service
```

Expected: Build succeeds

**Step 4: Commit**

```bash
git add Dockerfile compose.yaml
git commit -m "Update Docker for TypeScript multi-stage build with tini"
```

---

### Task 20: Lint, Format, Final Verification

**Step 1: Run Prettier to format all files**

```bash
npx prettier --write src/ tests/
```

**Step 2: Run ESLint and fix auto-fixable issues**

```bash
npx eslint src/ tests/ --fix
```

Review any remaining lint errors and fix manually. Common strict-type-checked issues:
- `@typescript-eslint/no-unsafe-assignment` — may need explicit type annotations on some `page.evaluate` returns
- `@typescript-eslint/no-unsafe-member-access` — may need type guards
- `@typescript-eslint/restrict-template-expressions` — ensure template literals only interpolate strings

**Step 3: Run full verification**

```bash
npm run build && npm run lint && npm test
```

Expected: All three commands pass

**Step 4: Commit**

```bash
git add -A
git commit -m "Apply formatting and fix lint errors"
```

---

### Task 21: Update package.json Metadata

**Step 1: Update package.json metadata**

```json
{
  "name": "sync-calendars",
  "main": "dist/server.js"
}
```

**Step 2: Final full verification**

```bash
npm run build && npm run lint && npm test
```

Expected: All PASS

**Step 3: Commit**

```bash
git add package.json
git commit -m "Update package metadata for TypeScript"
```

---

## Verification Checklist

After all tasks are complete, verify:

1. `npm run build` — TypeScript compiles without errors
2. `npm run lint` — no ESLint violations
3. `npm test` — all tests pass
4. `docker compose build sync-service` — multi-stage build succeeds
5. `docker compose up sync-service` — service starts, `curl localhost:3001/health` responds
6. No `.js` source files remain in project root or `routes/` directory
7. `dist/` directory contains compiled output
8. `git log --oneline` shows clean, glanceable commit history
