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
	readonly IDLE_TIMEOUT: number;
	private contextCleanupTimer: ReturnType<typeof setTimeout> | null;
	private browserCleanupTimer: ReturnType<typeof setTimeout> | null;

	constructor() {
		this.browser = null;
		this.context = null;
		this.page = null;
		this.isAuthenticated = false;
		this.lastUsed = null;
		this.isInUse = false;
		this.IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
		this.contextCleanupTimer = null;
		this.browserCleanupTimer = null;
	}

	async getBrowser(debugMode = false): Promise<Browser> {
		// If browser exists and is not too old, reuse it
		if (this.browser && !this.isStale()) {
			logger.info('Reusing existing browser instance');
			this.isInUse = true;
			this.lastUsed = Date.now();
			return this.browser;
		}

		// Close stale browser if exists
		if (this.browser) {
			logger.info('Closing stale browser instance');
			await this.closeBrowser();
		}

		// Create new browser
		logger.info('Creating new browser instance');
		this.browser = await createBrowserInstance(debugMode);
		this.isInUse = true;
		this.lastUsed = Date.now();
		return this.browser;
	}

	async getContext(debugMode = false): Promise<BrowserContextResult> {
		// If context exists and is not stale, reuse it
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

		// Close stale context if exists
		if (this.context) {
			logger.info('Closing stale context');
			await this.closeContext();
		}

		// Get or create browser
		const browser = await this.getBrowser(debugMode);

		// Create new context and page
		logger.info('Creating new context and page');
		const { context, page } = await createBrowserContext(
			browser,
			debugMode,
		);
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

		// Clear existing cleanup timer if any
		if (this.contextCleanupTimer) {
			clearTimeout(this.contextCleanupTimer);
		}

		// Start cleanup timer
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

		// Clear existing cleanup timer if any
		if (this.browserCleanupTimer) {
			clearTimeout(this.browserCleanupTimer);
		}

		// Start cleanup timer
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
		// Clear cleanup timer if any
		if (this.contextCleanupTimer) {
			clearTimeout(this.contextCleanupTimer);
			this.contextCleanupTimer = null;
		}

		if (this.context) {
			try {
				await this.context.close();
				logger.info('Context closed successfully');
			} catch (error) {
				logger.error(
					'Error closing context:',
					error instanceof Error
						? error.message
						: 'Unknown error',
				);
			}
			this.context = null;
			this.page = null;
			this.isAuthenticated = false;
		}
	}

	async closeBrowser(): Promise<void> {
		// Clear both cleanup timers if any
		if (this.browserCleanupTimer) {
			clearTimeout(this.browserCleanupTimer);
			this.browserCleanupTimer = null;
		}

		// Close context first if it exists
		await this.closeContext();

		if (this.browser) {
			try {
				await this.browser.close();
			} catch (error) {
				logger.error(
					'Error closing browser:',
					error instanceof Error
						? error.message
						: 'Unknown error',
				);
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

// Single shared browser pool instance
export const browserPool = new BrowserPool();
