import type { BrowserContext } from 'playwright';
import { browserPool } from '../../src/services/browser-pool.js';

describe('BrowserPool Context Management', () => {
	describe('Initial State', () => {
		it('should have correct initial state', () => {
			expect(browserPool.browser).toBeNull();
			expect(browserPool.context).toBeNull();
			expect(browserPool.page).toBeNull();
			expect(browserPool.isAuthenticated).toBe(false);
			expect(browserPool.isInUse).toBe(false);
		});

		it('should have IDLE_TIMEOUT configured', () => {
			expect(browserPool.IDLE_TIMEOUT).toBe(5 * 60 * 1000);
		});
	});

	describe('Context Management Methods', () => {
		it('should have getContext method', () => {
			expect(typeof browserPool.getContext).toBe('function');
		});

		it('should have markAsAuthenticated method', () => {
			expect(typeof browserPool.markAsAuthenticated).toBe('function');
		});

		it('should have releaseContext method', () => {
			expect(typeof browserPool.releaseContext).toBe('function');
		});

		it('should have closeContext method', () => {
			expect(typeof browserPool.closeContext).toBe('function');
		});
	});

	describe('markAsAuthenticated', () => {
		beforeEach(() => {
			browserPool.isAuthenticated = false;
		});

		it('should mark context as authenticated', () => {
			browserPool.markAsAuthenticated();
			expect(browserPool.isAuthenticated).toBe(true);
		});
	});

	describe('isStale', () => {
		beforeEach(() => {
			browserPool.lastUsed = null;
		});

		it('should return false when lastUsed is null', () => {
			expect(browserPool.isStale()).toBe(false);
		});

		it('should return false for recently used context', () => {
			browserPool.lastUsed = Date.now();
			expect(browserPool.isStale()).toBe(false);
		});

		it('should return true for context older than IDLE_TIMEOUT', () => {
			browserPool.lastUsed = Date.now() - 6 * 60 * 1000; // 6 minutes ago
			expect(browserPool.isStale()).toBe(true);
		});

		it('should return false for context exactly at IDLE_TIMEOUT', () => {
			browserPool.lastUsed = Date.now() - browserPool.IDLE_TIMEOUT;
			expect(browserPool.isStale()).toBe(false);
		});

		it('should return true for context just past IDLE_TIMEOUT', () => {
			browserPool.lastUsed = Date.now() - browserPool.IDLE_TIMEOUT - 1;
			expect(browserPool.isStale()).toBe(true);
		});
	});

	describe('closeContext', () => {
		it('should reset context state', async () => {
			// Set up mock context
			browserPool.context = {
				close: jest.fn(),
			} as unknown as BrowserContext;
			browserPool.page = {
				mockPage: true,
			} as unknown as typeof browserPool.page;
			browserPool.isAuthenticated = true;

			await browserPool.closeContext();

			expect(browserPool.context).toBeNull();
			expect(browserPool.page).toBeNull();
			expect(browserPool.isAuthenticated).toBe(false);
		});

		it('should handle missing context gracefully', async () => {
			browserPool.context = null;
			await expect(browserPool.closeContext()).resolves.not.toThrow();
		});

		it('should handle context.close errors', async () => {
			browserPool.context = {
				close: jest.fn().mockRejectedValue(new Error('Close failed')),
			} as unknown as BrowserContext;

			await expect(browserPool.closeContext()).resolves.not.toThrow();
			expect(browserPool.context).toBeNull();
		});
	});

	describe('releaseContext', () => {
		beforeEach(() => {
			jest.useFakeTimers();
			browserPool.isInUse = true;
		});

		afterEach(() => {
			jest.useRealTimers();
		});

		it('should mark context as not in use', async () => {
			await browserPool.releaseContext();
			expect(browserPool.isInUse).toBe(false);
		});

		it('should update lastUsed timestamp', async () => {
			const beforeTime = Date.now();
			await browserPool.releaseContext();
			const afterTime = Date.now();

			expect(browserPool.lastUsed).toBeGreaterThanOrEqual(beforeTime);
			expect(browserPool.lastUsed).toBeLessThanOrEqual(afterTime);
		});
	});
});
