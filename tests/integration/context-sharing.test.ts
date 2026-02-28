import type { Browser, BrowserContext, Page } from 'playwright';
import { browserPool } from '../../src/services/browser-pool.js';

describe('BrowserPool Context Sharing Integration Tests', () => {
	// Mock browser and context for testing
	let mockBrowser: Browser;
	let mockContext: BrowserContext;
	let mockPage: Page;

	beforeEach(() => {
		// Reset browser pool state
		browserPool.browser = null;
		browserPool.context = null;
		browserPool.page = null;
		browserPool.isAuthenticated = false;
		browserPool.isInUse = false;
		browserPool.lastUsed = null;

		// Create mocks
		mockPage = {
			goto: jest.fn(),
			fill: jest.fn(),
			click: jest.fn(),
			url: jest.fn(() => 'https://example.com'),
		} as unknown as Page;

		mockContext = {
			close: jest.fn(),
			newPage: jest.fn().mockResolvedValue(mockPage),
		} as unknown as BrowserContext;

		mockBrowser = {
			close: jest.fn(),
			newContext: jest.fn().mockResolvedValue(mockContext),
		} as unknown as Browser;
	});

	afterEach(async () => {
		// Cleanup after each test
		await browserPool.closeContext();
		await browserPool.closeBrowser();
	});

	describe('Context Sharing Between Sequential Endpoint Calls', () => {
		it('should create new context on first call', async () => {
			// Mock the browser creation
			browserPool.browser = mockBrowser;

			// Simulate first endpoint call
			const result1 = await browserPool.getContext(false);

			expect(result1.context).toBeDefined();
			expect(result1.page).toBeDefined();
			expect(result1.isAuthenticated).toBe(false);
			expect(browserPool.isInUse).toBe(true);
		});

		it('should reuse context on second call within timeout', async () => {
			// Mock the browser creation
			browserPool.browser = mockBrowser;

			// First call - creates context
			const result1 = await browserPool.getContext(false);
			const firstContext = result1.context;
			const firstPage = result1.page;

			// Mark as authenticated
			browserPool.markAsAuthenticated();

			// Release context
			await browserPool.releaseContext();

			// Second call - should reuse context
			const result2 = await browserPool.getContext(false);

			expect(result2.context).toBe(firstContext);
			expect(result2.page).toBe(firstPage);
			expect(result2.isAuthenticated).toBe(true); // Should preserve auth state
		});

		it('should not reuse stale context', async () => {
			// Mock getBrowser to avoid proxy requirement when browser is stale
			const getBrowserSpy = jest
				.spyOn(browserPool, 'getBrowser')
				.mockResolvedValue(mockBrowser);

			// Set up browser and context
			browserPool.browser = mockBrowser;
			browserPool.context = mockContext;
			browserPool.page = mockPage;
			browserPool.isAuthenticated = true;

			// Make context stale
			browserPool.lastUsed = Date.now() - 6 * 60 * 1000; // 6 minutes ago

			// Second call - should create new context
			const result2 = await browserPool.getContext(false);

			expect(result2.isAuthenticated).toBe(false); // New context, not authenticated

			// Cleanup
			getBrowserSpy.mockRestore();
		});
	});

	describe('Simulated Endpoint Workflow', () => {
		it('should simulate /obliterator then /mutator workflow', async () => {
			// Mock the browser creation
			browserPool.browser = mockBrowser;

			// Simulate /obliterator endpoint
			const obliteratorContext = await browserPool.getContext(false);
			expect(obliteratorContext.isAuthenticated).toBe(false);

			// Simulate authentication in /obliterator
			browserPool.markAsAuthenticated();
			expect(browserPool.isAuthenticated).toBe(true);

			// Release context (keeping it alive)
			await browserPool.releaseContext();

			// Simulate /mutator endpoint (should reuse context)
			const mutatorContext = await browserPool.getContext(false);

			// Should reuse same context and page
			expect(mutatorContext.context).toBe(obliteratorContext.context);
			expect(mutatorContext.page).toBe(obliteratorContext.page);

			// Should preserve authentication state
			expect(mutatorContext.isAuthenticated).toBe(true);

			// Release context
			await browserPool.releaseContext();
		});

		it('should handle standalone /mutator call', async () => {
			// Mock the browser creation
			browserPool.browser = mockBrowser;

			// Simulate /mutator called without /obliterator first
			const mutatorContext = await browserPool.getContext(false);

			// Should create new context
			expect(mutatorContext.context).toBeDefined();
			expect(mutatorContext.page).toBeDefined();

			// Should not be authenticated
			expect(mutatorContext.isAuthenticated).toBe(false);

			// Simulate authentication
			browserPool.markAsAuthenticated();

			// Release context
			await browserPool.releaseContext();
		});

		it('should handle multiple endpoint calls in sequence', async () => {
			// Mock the browser creation
			browserPool.browser = mockBrowser;

			// First endpoint
			const context1 = await browserPool.getContext(false);
			browserPool.markAsAuthenticated();
			await browserPool.releaseContext();

			// Second endpoint
			const context2 = await browserPool.getContext(false);
			expect(context2.isAuthenticated).toBe(true);
			await browserPool.releaseContext();

			// Third endpoint
			const context3 = await browserPool.getContext(false);
			expect(context3.isAuthenticated).toBe(true);
			await browserPool.releaseContext();

			// All should use same context
			expect(context1.context).toBe(context2.context);
			expect(context2.context).toBe(context3.context);
		});
	});

	describe('Authentication State Preservation', () => {
		it('should preserve authentication state across releases', async () => {
			// Mock the browser creation
			browserPool.browser = mockBrowser;

			// Create context and authenticate
			await browserPool.getContext(false);
			browserPool.markAsAuthenticated();
			await browserPool.releaseContext();

			// Get context again
			const result = await browserPool.getContext(false);

			expect(result.isAuthenticated).toBe(true);
		});

		it('should reset authentication state when context is closed', async () => {
			// Mock the browser creation
			browserPool.browser = mockBrowser;

			// Create context and authenticate
			await browserPool.getContext(false);
			browserPool.markAsAuthenticated();

			// Close context
			await browserPool.closeContext();

			expect(browserPool.isAuthenticated).toBe(false);
		});

		it('should reset authentication state when creating new context', async () => {
			// Mock getBrowser to avoid proxy requirement when browser is stale
			const getBrowserSpy = jest
				.spyOn(browserPool, 'getBrowser')
				.mockResolvedValue(mockBrowser);

			// Set up browser and context
			browserPool.browser = mockBrowser;
			browserPool.context = mockContext;
			browserPool.page = mockPage;
			browserPool.isAuthenticated = true;

			// Make context stale
			browserPool.lastUsed = Date.now() - 6 * 60 * 1000;

			// Get context again (should create new one)
			const result = await browserPool.getContext(false);

			expect(result.isAuthenticated).toBe(false);

			// Cleanup
			getBrowserSpy.mockRestore();
		});
	});

	describe('Error Handling', () => {
		it('should handle context release on error', async () => {
			// Mock the browser creation
			browserPool.browser = mockBrowser;

			await browserPool.getContext(false);
			browserPool.markAsAuthenticated();

			// Simulate error scenario - release context anyway
			await browserPool.releaseContext();

			expect(browserPool.isInUse).toBe(false);
			expect(browserPool.lastUsed).toBeTruthy();
		});

		it('should handle multiple releases gracefully', async () => {
			// Mock the browser creation
			browserPool.browser = mockBrowser;

			await browserPool.getContext(false);

			// Release multiple times
			await browserPool.releaseContext();
			await browserPool.releaseContext();
			await browserPool.releaseContext();

			expect(browserPool.isInUse).toBe(false);
		});
	});

	describe('Concurrency Safety', () => {
		it('should mark context as in use when acquired', async () => {
			// Mock the browser creation
			browserPool.browser = mockBrowser;

			await browserPool.getContext(false);

			expect(browserPool.isInUse).toBe(true);
		});

		it('should update lastUsed timestamp on each acquisition', async () => {
			// Mock the browser creation
			browserPool.browser = mockBrowser;

			await browserPool.getContext(false);
			const firstUsed = browserPool.lastUsed;

			await browserPool.releaseContext();

			// Small delay
			await new Promise((resolve) => setTimeout(resolve, 10));

			await browserPool.getContext(false);
			const secondUsed = browserPool.lastUsed;

			expect(secondUsed!).toBeGreaterThanOrEqual(firstUsed!);
		});
	});

	describe('Cleanup Behavior', () => {
		it('should close context when closing browser', async () => {
			// Mock the browser creation
			browserPool.browser = mockBrowser;

			await browserPool.getContext(false);
			browserPool.markAsAuthenticated();

			await browserPool.closeBrowser();

			expect(browserPool.context).toBeNull();
			expect(browserPool.page).toBeNull();
			expect(browserPool.isAuthenticated).toBe(false);
			expect(browserPool.browser).toBeNull();
		});

		it('should handle cleanup with null context', async () => {
			browserPool.context = null;
			browserPool.browser = null;

			await expect(browserPool.closeBrowser()).resolves.not.toThrow();
		});
	});
});
