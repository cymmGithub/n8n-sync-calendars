import https from 'https';
import http from 'http';
import { logger } from '../utils/logger.js';
import type {
	Proxy,
	ProxyCredentials,
	ProxyList,
	ProxyResult,
} from '../types/index.js';

export class ProxyManager {
	availableAccounts: number[];
	proxyLists: Record<string, ProxyList>;
	ipUsageCount: Map<string, number>;
	currentThreshold: number;
	lastUsedAccount: number | null;
	lastUsedIP: string | null;
	lastFetch: number | null;
	readonly CACHE_TTL: number;
	blacklistedIPs: Set<string>;

	constructor() {
		// Dynamically detect available accounts from environment variables
		this.availableAccounts = this.detectAvailableAccounts();
		this.proxyLists = {};

		// Initialize proxy lists for all available accounts
		for (const accountNum of this.availableAccounts) {
			this.proxyLists[`account${accountNum}`] = {
				proxies: [],
				credentials: null,
			};
		}

		this.ipUsageCount = new Map(); // Track usage per IP:port
		this.currentThreshold = 10; // Start with 10 uses per IP
		this.lastUsedAccount = null; // Track which account was used last
		this.lastUsedIP = null; // Track last IP to avoid consecutive reuse
		this.lastFetch = null;
		this.CACHE_TTL = 60 * 60 * 1000; // 1 hour
		this.blacklistedIPs = new Set(); // Track blacklisted IPs
		this.loadBlacklist();

		logger.info(
			`ProxyManager initialized with ${this.availableAccounts.length} accounts: ${this.availableAccounts.join(', ')}`,
		);
	}

	// Detect available WEBSHARE_ACCOUNT_* environment variables
	private detectAvailableAccounts(): number[] {
		const accounts: number[] = [];
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
	loadBlacklist(): void {
		const blacklistEnv = process.env['PROXY_BLACKLIST'];
		if (!blacklistEnv) {
			logger.info('No proxy blacklist configured');
			return;
		}

		// Parse comma-separated list of IPs or IP:port combinations
		const blacklistedItems = blacklistEnv
			.split(',')
			.map((item) => item.trim())
			.filter((item) => item);

		this.blacklistedIPs = new Set(blacklistedItems);

		logger.info(
			`Loaded ${this.blacklistedIPs.size} blacklisted IPs/ports: ${Array.from(this.blacklistedIPs).join(', ')}`,
		);
	}

	// Check if an IP:port is blacklisted
	isBlacklisted(ipPort: string): boolean {
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

	// Parse proxy list in format: ip:port:username:password
	parseProxyList(data: string): {
		proxies: Proxy[];
		credentials: ProxyCredentials | null;
	} {
		const lines = data.trim().split('\n');
		const proxies: Proxy[] = [];
		let credentials: ProxyCredentials | null = null;

		for (const line of lines) {
			const parts = line.trim().split(':');
			if (parts.length === 4) {
				const [ip, port, username, password] = parts as [
					string,
					string,
					string,
					string,
				];
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
	async refreshProxyLists(): Promise<boolean> {
		try {
			logger.info(
				`Fetching proxy lists from ${this.availableAccounts.length} Webshare accounts...`,
			);

			// Fetch from all available accounts in parallel
			const fetchPromises = this.availableAccounts.map((accountNum) =>
				this.fetchProxyList(process.env[`WEBSHARE_ACCOUNT_${accountNum}`]!),
			);

			const dataList = await Promise.all(fetchPromises);

			// Parse and store results for each account
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
			logger.error(
				`Failed to refresh proxy lists: ${error instanceof Error ? error.message : 'Unknown error'}`,
			);
			// If we have cached data, continue using it
			const firstAccount = this.availableAccounts[0] as number | undefined;
			if (
				firstAccount !== undefined &&
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
				(this.proxyLists[`account${firstAccount}`]?.proxies.length ?? 0) > 0
			) {
				logger.warn('Using cached proxy lists');
				return false;
			}
			throw error;
		}
	}

	// Check if cache needs refresh
	private needsRefresh(): boolean {
		if (!this.lastFetch) return true;
		return Date.now() - this.lastFetch > this.CACHE_TTL;
	}

	// Get all unique IPs from all accounts (excluding blacklisted ones)
	getAllUniqueIPs(): Proxy[] {
		const ipSet = new Set<string>();
		const ipList: Proxy[] = [];

		// Combine IPs from all accounts
		for (const accountNum of this.availableAccounts) {
			const accountKey = `account${accountNum}`;
			const accountData = this.proxyLists[accountKey];

			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive check for runtime safety
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

	// Get random proxy with rotation logic
	async getRandomProxy(): Promise<ProxyResult> {
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
		let nextAccount: number;
		if (this.lastUsedAccount === null) {
			// First use, start with account 1
			nextAccount = this.availableAccounts[0]!;
		} else {
			// Find current account index and move to next
			const currentIndex = this.availableAccounts.indexOf(this.lastUsedAccount);
			const nextIndex = (currentIndex + 1) % this.availableAccounts.length;
			nextAccount = this.availableAccounts[nextIndex]!;
		}
		this.lastUsedAccount = nextAccount;

		// Get credentials for selected account
		const accountKey = `account${nextAccount}`;
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- key may not exist at runtime
		const credentials = this.proxyLists[accountKey]?.credentials;

		if (!credentials) {
			throw new Error(`No credentials available for ${accountKey}`);
		}

		// Find available IPs (usage < currentThreshold)
		let availableIPs = allIPs.filter((proxy) => {
			const ipPort = `${proxy.ip}:${proxy.port}`;
			const usage = this.ipUsageCount.get(ipPort) ?? 0;
			return usage < this.currentThreshold;
		});

		// If no IPs available, increment threshold
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
		const currentUsage = this.ipUsageCount.get(selectedIPPort) ?? 0;
		this.ipUsageCount.set(selectedIPPort, currentUsage + 1);

		// Update last used IP
		this.lastUsedIP = selectedIPPort;

		// Log selection details
		logger.info(
			`Proxy selected: ${selectedIPPort} (Account ${nextAccount}, Usage: ${currentUsage + 1}/${this.currentThreshold})`,
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

		// Count IPs by usage level
		for (const [, count] of this.ipUsageCount.entries()) {
			const bucket = Math.floor(count / 10) * 10;
			const key = `${bucket}-${bucket + 9}`;
			stats.usageDistribution[key] = (stats.usageDistribution[key] ?? 0) + 1;
		}

		logger.info(`Proxy usage stats: ${JSON.stringify(stats)}`);
	}
}

// Single shared proxy manager instance
export const proxyManager = new ProxyManager();
