import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page } from 'playwright';
import { logger } from './logger.js';
import { proxyManager } from '../services/proxy-manager.js';

// Configure stealth plugin to avoid bot detection
chromium.use(stealth());

// Shared browser configuration function
export async function createBrowserInstance(
	debugMode = false,
): Promise<Browser> {
	const browserOptions: {
		headless: boolean;
		args: string[];
		proxy?: {
			server: string;
			username: string;
			password: string;
		};
	} = {
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
	};

	// Get proxy from the ProxyManager
	const proxy = await proxyManager.getRandomProxy();

	browserOptions.proxy = {
		server: proxy.server,
		username: proxy.username,
		password: proxy.password,
	};

	const browser = await chromium.launch(browserOptions);
	logger.info('Browser instance created successfully');

	return browser;
}

// Helper function to create browser context
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
		page.on('console', (msg) => {
			console.log('Browser console:', msg.text());
		});
		page.on('pageerror', (err) => {
			console.error('Browser page error:', err);
		});
	}

	return { context, page };
}

// Helper function for random delays (human-like behavior)
export const randomDelay = (min = 100, max = 300): Promise<void> => {
	return new Promise((resolve) =>
		setTimeout(resolve, Math.random() * (max - min) + min),
	);
};
