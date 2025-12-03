const winston = require('winston');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const https = require('https');
const http = require('http');
const moment = require('moment');

// Configure stealth plugin to avoid bot detection
chromium.use(stealth);

// Constants
const TICKS_PER_MILLISECOND = 10_000;
const EPOCH_TICKS_AT_UNIX_EPOCH = 621_355_968_000_000_000;

// Shared logger configuration
const logger = winston.createLogger({
	level: 'info',
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.json()
	),
	transports: [
		new winston.transports.File({ filename: 'error.log', level: 'error' }),
		new winston.transports.File({ filename: 'combined.log' }),
		new winston.transports.Console({
			format: winston.format.simple(),
		}),
	],
});

// General utility functions
const getCurrentDate = () => {
	return new Date().toISOString().split('T')[0];
};

const getCurrentDateMidnight = () => {
	return moment.utc().startOf('day').toISOString();
};

// Oponeo-specific functions
async function authenticate_oponeo(page, email, password) {
	try {
		await page.goto(process.env.OPONEO_LOGIN_URL, {
			waitUntil: 'load', timeout: 60000
		});

		await page.fill('input[name="Login"]', email);
		await page.fill('input[name="Password"]', password);

		await Promise.all([
			page.click('a.button.enter', { timeout: 60000 }),
			page.waitForNavigation({ waitUntil: 'load', timeout: 60000 }),
		]);

		const current_url = page.url();
		if (current_url.includes('logowanie')) {
			throw new Error('Login failed - still on login page');
		}

		logger.info('Successfully logged in to Oponeo');
		return true;
	} catch (error) {
		logger.error(`Authentication failed: ${error.message}`);
		throw error;
	}
}

async function scrape_reservations_list(page) {
	try {
		// Extract all reservations from the current page and filter
		// for 'R' prefix which at this moment indicates reservation from oponeo
		const reservations = await page.evaluate(() => {
			const rows = Array.from(document.querySelectorAll('.table .row'));
			return rows
				.map((row) => {
					const reservation_number = row
						.querySelector('.reservationNumber .content')
						?.textContent.trim();
					const licence_plate = row
						.querySelector('.registrationNumber .content')
						?.textContent.trim();
					// Only include if reservation number starts with 'R' or licence plate = 'KAKTUSXXX' for debugging purposes
					if (
						!licence_plate.startsWith('KAKTUSXXX') &&
						!reservation_number.startsWith('R')
					) {
						return null;
					}

					return {
						reservation_url: row.querySelector('a.reservationNumber')?.href,
						reservation_number,
					};
				})
				.filter((reservation) => reservation !== null);
		});

		logger.info(
			`Found ${reservations.length} reservations starting with 'R' on current page`
		);
		return reservations;
	} catch (error) {
		logger.error(`Error scraping reservations list: ${error.message}`);
		throw error;
	}
}

async function get_all_pages_reservations(page) {
	try {
		const all_reservations = [];
		let current_page = 1;
		const reservations_from_now_url = get_reservations_from_now_url();

		const total_pages = await page.evaluate(() => {
			const pager_items = Array.from(
				document.querySelectorAll(
					'.pager li:not(:has(a[ajaxsubmit="NextPage"]))'
				)
			);

			if (pager_items.length === 0) {
				console.log('No pagination found, assuming single page');
				return 1;
			}

			const last_page_item = pager_items
				.filter((item) => /^\d+$/.test(item.textContent.trim()))
				.pop();

			if (!last_page_item) {
				console.log(
					'Could not find last numeric page item, assuming single page'
				);
				return 1;
			}

			const page_text = last_page_item.textContent.trim();
			const page_number = parseInt(page_text) || 1;

			return page_number;
		});

		logger.info(`Total pages detected: ${total_pages}`);

		logger.info(`Processing page ${current_page}/${total_pages}`);
		const first_page_reservations = await scrape_reservations_list(page);
		all_reservations.push(...first_page_reservations);

		while (current_page < total_pages) {
			current_page++;

			logger.info(`Navigating to page ${current_page}/${total_pages}`);
			const next_page_url = `${reservations_from_now_url}&strona=${current_page}`;
			await page.goto(next_page_url, { waitUntil: 'load' });

			logger.info(`Processing page ${current_page}/${total_pages}`);
			const page_reservations = await scrape_reservations_list(page);
			all_reservations.push(...page_reservations);
		}

		logger.info(
			`Processed ${total_pages} pages with ${all_reservations.length} reservations`
		);
		return {
			reservations: all_reservations,
			stats: {
				total_pages,
				filtered_count: all_reservations.length,
				pages_processed: total_pages,
			},
		};
	} catch (error) {
		logger.error(`Pagination error: ${error.message}`);
		throw error;
	}
}

async function scrape_reservation_details(page, reservation_url) {
	try {
		await page.goto(reservation_url, { waitUntil: 'load' });

		logger.info(`Processing Oponeo reservation: ${reservation_url}`);

		const details = await page.evaluate(() => {
			const get_produkty_text_content = () => {
				const produkty = Array.from(
					document.querySelectorAll('div.title')
				).find((el) => el.textContent?.trim() === 'Produkty');
				if (!produkty) return null;
				const description = produkty.nextElementSibling;

				return description?.textContent?.trim() || null;
			};
			const get_labels_text_content = (label_text) => {
				const labels = Array.from(document.querySelectorAll('p label'));
				const label = labels.find((l) => l.textContent.trim() === label_text);
				if (!label) return '';
				const parent_p = label.closest('p');
				if (!parent_p) return '';

				return parent_p.textContent.replace(label_text, '').trim();
			};

			return {
				reservation_number: get_labels_text_content('Numer rezerwacji:'),
				date: get_labels_text_content('Data:'),
				time: get_labels_text_content('Godzina:'),
				position: get_labels_text_content('Stanowisko:'),
				description: get_produkty_text_content(),
				client_name: get_labels_text_content('Imię i nazwisko:'),
				phone: get_labels_text_content('Nr telefonu:'),
				registration_number: get_labels_text_content('Nr rejestracyjny:'),
				email: get_labels_text_content('E-mail:'),
			};
		});

		return details;
	} catch (error) {
		logger.error(`Error scraping reservation details: ${error.message}`);
		throw error;
	}
}

const get_reservations_from_now_url = () => {
	const reservations_base_url = process.env.OPONEO_RESERVATIONS_LIST_URL;
	const js_now = new Date();
	// for debugging
	// const some_time_ago= new Date(js_now.getTime() - 40 * 24 * 60 * 60 * 1000);
	const dot_net_now =
		js_now.getTime() * TICKS_PER_MILLISECOND + EPOCH_TICKS_AT_UNIX_EPOCH;
	console.log('dot_net_now', dot_net_now);

	return `${reservations_base_url}?data-od=${dot_net_now}`;
};

// Helper function to convert .NET ticks to date
const convertTicksToDate = (ticks) => {
	const milliseconds = Number(
		(BigInt(ticks) - BigInt(EPOCH_TICKS_AT_UNIX_EPOCH)) / BigInt(TICKS_PER_MILLISECOND)
	);
	return new Date(milliseconds);
};

const formatTime = (date) => {
	const hours = String(date.getUTCHours()).padStart(2, '0');
	const minutes = String(date.getUTCMinutes()).padStart(2, '0');
	return `${hours}:${minutes}`;
};

function isoToTicks(isoString) {
	// Remove timezone info if present and parse as local time
	const cleanIsoString = isoString.replace(/[+-]\d{2}:\d{2}$|Z$/, '');
	const date = new Date(cleanIsoString);

	// Ensure we're working with valid date
	if (isNaN(date.getTime())) {
		throw new Error(`Invalid ISO string: ${isoString}`);
	}

	const ms = BigInt(date.getTime());
	return ms * BigInt(TICKS_PER_MILLISECOND) + BigInt(EPOCH_TICKS_AT_UNIX_EPOCH);
}

// Browser pooling system with context management
class BrowserPool {
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

	async getBrowser(debugMode = false) {
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

	async getContext(debugMode = false) {
		// If context exists and is not stale, reuse it
		if (this.context && this.page && !this.isStale()) {
			logger.info('Reusing existing context and page', {
				authenticated: this.isAuthenticated
			});
			this.isInUse = true;
			this.lastUsed = Date.now();
			return {
				browser: this.browser,
				context: this.context,
				page: this.page,
				isAuthenticated: this.isAuthenticated
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
		const { context, page } = await createBrowserContext(browser, debugMode);
		this.context = context;
		this.page = page;
		this.isAuthenticated = false;
		this.isInUse = true;
		this.lastUsed = Date.now();

		return {
			browser: this.browser,
			context: this.context,
			page: this.page,
			isAuthenticated: this.isAuthenticated
		};
	}

	markAsAuthenticated() {
		this.isAuthenticated = true;
		logger.info('Context marked as authenticated');
	}

	async releaseContext() {
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

	async releaseBrowser() {
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

	isStale() {
		if (!this.lastUsed) return false;
		return Date.now() - this.lastUsed > this.IDLE_TIMEOUT;
	}

	async closeContext() {
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
				logger.error('Error closing context:', error.message);
			}
			this.context = null;
			this.page = null;
			this.isAuthenticated = false;
		}
	}

	async closeBrowser() {
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
				logger.error('Error closing browser:', error.message);
			}
			this.browser = null;
			this.isInUse = false;
			this.lastUsed = null;
		}
	}

	clearTimers() {
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
const browserPool = new BrowserPool();

// Proxy Management System
class ProxyManager {
	constructor() {
		// Dynamically detect available accounts from environment variables
		this.availableAccounts = this.detectAvailableAccounts();
		this.proxyLists = {};

		// Initialize proxy lists for all available accounts
		for (const accountNum of this.availableAccounts) {
			this.proxyLists[`account${accountNum}`] = { proxies: [], credentials: null };
		}

		this.ipUsageCount = new Map(); // Track usage per IP:port
		this.currentThreshold = 10; // Start with 10 uses per IP
		this.lastUsedAccount = null; // Track which account was used last
		this.lastUsedIP = null; // Track last IP to avoid consecutive reuse
		this.lastFetch = null;
		this.CACHE_TTL = 60 * 60 * 1000; // 1 hour
		this.blacklistedIPs = new Set(); // Track blacklisted IPs
		this.loadBlacklist();

		logger.info(`ProxyManager initialized with ${this.availableAccounts.length} accounts: ${this.availableAccounts.join(', ')}`);
	}

	// Detect available WEBSHARE_ACCOUNT_* environment variables
	detectAvailableAccounts() {
		const accounts = [];
		let accountNum = 1;

		// Check for WEBSHARE_ACCOUNT_1, WEBSHARE_ACCOUNT_2, etc.
		while (process.env[`WEBSHARE_ACCOUNT_${accountNum}`]) {
			accounts.push(accountNum);
			accountNum++;
		}

		if (accounts.length === 0) {
			logger.warn('No WEBSHARE_ACCOUNT_* environment variables found');
		}

		return accounts;
	}

	// Load blacklisted IPs from environment variable
	loadBlacklist() {
		const blacklistEnv = process.env.PROXY_BLACKLIST;
		if (!blacklistEnv) {
			logger.info('No proxy blacklist configured');
			return;
		}

		// Parse comma-separated list of IPs or IP:port combinations
		const blacklistedItems = blacklistEnv.split(',').map(item => item.trim()).filter(item => item);

		this.blacklistedIPs = new Set(blacklistedItems);

		logger.info(`Loaded ${this.blacklistedIPs.size} blacklisted IPs/ports: ${Array.from(this.blacklistedIPs).join(', ')}`);
	}

	// Check if an IP:port is blacklisted
	isBlacklisted(ipPort) {
		// Check exact IP:port match
		if (this.blacklistedIPs.has(ipPort)) {
			return true;
		}

		// Check IP-only match (in case blacklist contains just IPs without ports)
		const ip = ipPort.split(':')[0];
		if (this.blacklistedIPs.has(ip)) {
			return true;
		}

		return false;
	}

	// Fetch proxy list from Webshare URL
	async fetchProxyList(url) {
		return new Promise((resolve, reject) => {
			const urlObj = new URL(url);
			const protocol = urlObj.protocol === 'https:' ? https : http;

			protocol
				.get(url, (res) => {
					let data = '';

					res.on('data', (chunk) => {
						data += chunk;
					});

					res.on('end', () => {
						resolve(data);
					});
				})
				.on('error', (err) => {
					reject(err);
				});
		});
	}

	// Parse proxy list in format: ip:port:username:password
	parseProxyList(data) {
		const lines = data.trim().split('\n');
		const proxies = [];
		let credentials = null;

		for (const line of lines) {
			const parts = line.trim().split(':');
			if (parts.length === 4) {
				const [ip, port, username, password] = parts;
				proxies.push({ ip, port });
				// Store credentials (same for all proxies in the list)
				if (!credentials) {
					credentials = { username, password };
				}
			}
		}

		return { proxies, credentials };
	}

	// Refresh proxy lists from all available accounts
	async refreshProxyLists() {
		try {
			logger.info(`Fetching proxy lists from ${this.availableAccounts.length} Webshare accounts...`);

			// Fetch from all available accounts in parallel
			const fetchPromises = this.availableAccounts.map(accountNum =>
				this.fetchProxyList(process.env[`WEBSHARE_ACCOUNT_${accountNum}`])
			);

			const dataList = await Promise.all(fetchPromises);

			// Parse and store results for each account
			const accountStats = [];
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
			logger.error(`Failed to refresh proxy lists: ${error.message}`);
			// If we have cached data, continue using it
			const firstAccount = this.availableAccounts[0];
			if (firstAccount && this.proxyLists[`account${firstAccount}`]?.proxies.length > 0) {
				logger.warn('Using cached proxy lists');
				return false;
			}
			throw error;
		}
	}

	// Check if cache needs refresh
	needsRefresh() {
		if (!this.lastFetch) return true;
		return Date.now() - this.lastFetch > this.CACHE_TTL;
	}

	// Get all unique IPs from all accounts (excluding blacklisted ones)
	getAllUniqueIPs() {
		const ipSet = new Set();
		const ipList = [];

		// Combine IPs from all accounts
		for (const accountNum of this.availableAccounts) {
			const accountKey = `account${accountNum}`;
			const accountData = this.proxyLists[accountKey];

			if (!accountData || !accountData.proxies) {
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

	// Get random proxy with rotation logic
	async getRandomProxy() {
		// Refresh proxy lists if needed
		if (this.needsRefresh()) {
			await this.refreshProxyLists();
		}

		// Get all unique IPs
		const allIPs = this.getAllUniqueIPs();

		if (allIPs.length === 0) {
			throw new Error('No proxies available');
		}

		// Determine next account (rotate through all available accounts)
		let nextAccount;
		if (this.lastUsedAccount === null) {
			// First use, start with account 1
			nextAccount = this.availableAccounts[0];
		} else {
			// Find current account index and move to next
			const currentIndex = this.availableAccounts.indexOf(this.lastUsedAccount);
			const nextIndex = (currentIndex + 1) % this.availableAccounts.length;
			nextAccount = this.availableAccounts[nextIndex];
		}
		this.lastUsedAccount = nextAccount;

		// Get credentials for selected account
		const accountKey = `account${nextAccount}`;
		const credentials = this.proxyLists[accountKey]?.credentials;

		if (!credentials) {
			throw new Error(`No credentials available for ${accountKey}`);
		}

		// Find available IPs (usage < currentThreshold)
		let availableIPs = allIPs.filter((proxy) => {
			const ipPort = `${proxy.ip}:${proxy.port}`;
			const usage = this.ipUsageCount.get(ipPort) || 0;
			return usage < this.currentThreshold;
		});

		// If no IPs available, increment threshold
		while (availableIPs.length === 0) {
			this.currentThreshold += 10;
			logger.warn(
				`All IPs exhausted at previous threshold. Increasing to ${this.currentThreshold}`
			);

			availableIPs = allIPs.filter((proxy) => {
				const ipPort = `${proxy.ip}:${proxy.port}`;
				const usage = this.ipUsageCount.get(ipPort) || 0;
				return usage < this.currentThreshold;
			});
		}

		// Filter out last used IP to avoid consecutive reuse
		if (this.lastUsedIP && availableIPs.length > 1) {
			availableIPs = availableIPs.filter((proxy) => {
				const ipPort = `${proxy.ip}:${proxy.port}`;
				return ipPort !== this.lastUsedIP;
			});
		}

		// Randomly select from available IPs
		const selectedProxy =
			availableIPs[Math.floor(Math.random() * availableIPs.length)];
		const selectedIPPort = `${selectedProxy.ip}:${selectedProxy.port}`;

		// Update usage count
		const currentUsage = this.ipUsageCount.get(selectedIPPort) || 0;
		this.ipUsageCount.set(selectedIPPort, currentUsage + 1);

		// Update last used IP
		this.lastUsedIP = selectedIPPort;

		// Log selection details
		logger.info(
			`Proxy selected: ${selectedIPPort} (Account ${nextAccount}, Usage: ${currentUsage + 1}/${this.currentThreshold})`
		);

		// Log usage statistics
		this.logUsageStats();

		return {
			server: selectedIPPort,
			username: credentials.username,
			password: credentials.password,
			account: nextAccount,
		};
	}

	// Log current usage statistics
	logUsageStats() {
		const stats = {
			totalIPs: this.ipUsageCount.size,
			threshold: this.currentThreshold,
			usageDistribution: {},
		};

		// Count IPs by usage level
		for (const [ip, count] of this.ipUsageCount.entries()) {
			const bucket = Math.floor(count / 10) * 10;
			const key = `${bucket}-${bucket + 9}`;
			stats.usageDistribution[key] = (stats.usageDistribution[key] || 0) + 1;
		}

		logger.info(`Proxy usage stats: ${JSON.stringify(stats)}`);
	}
}

// Single shared proxy manager instance
const proxyManager = new ProxyManager();

// Shared browser configuration function
async function createBrowserInstance(debugMode = false) {
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
	};

	// Get proxy from the new ProxyManager
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
async function createBrowserContext(browser, debugMode = false) {
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

// Helper function for random delays (human-like behavior)
const randomDelay = (min = 100, max = 300) => {
	return new Promise((resolve) =>
		setTimeout(resolve, Math.random() * (max - min) + min)
	);
};

const getTimeSlotIndex = (timeString, date) => {
	if (!timeString || !date) {
		throw new Error('Both timeString and date are required');
	}

	// Check for 17:00 - always first slot
	if (timeString === '17:00') {
		return 0;
	}

	// Check for 14:00 on Saturday (6 = Saturday in JS Date.getDay())
	if (timeString === '14:00' && date.getDay() === 6) {
		return 0;
	}

	// All other cases - second slot
	return 1;
};

module.exports = {
	// Constants
	TICKS_PER_MILLISECOND,
	EPOCH_TICKS_AT_UNIX_EPOCH,

	// Shared utilities
	logger,
	getCurrentDate,
	getCurrentDateMidnight,

	// Oponeo functions
	authenticate_oponeo,
	scrape_reservations_list,
	get_all_pages_reservations,
	scrape_reservation_details,
	get_reservations_from_now_url,
	convertTicksToDate,
	formatTime,
	isoToTicks,
	getTimeSlotIndex,

	// Browser management
	browserPool,
	createBrowserInstance,
	createBrowserContext,
	randomDelay,
	proxyManager,
};
