import { proxyManager } from '../../src/services/proxy-manager.js';

describe('ProxyManager', () => {
	describe('Instance', () => {
		it('should be defined', () => {
			expect(proxyManager).toBeDefined();
		});

		it('should have required methods', () => {
			expect(typeof proxyManager.getRandomProxy).toBe('function');
			expect(typeof proxyManager.refreshProxyLists).toBe('function');
			expect(typeof proxyManager.parseProxyList).toBe('function');
		});

		it('should have initial state', () => {
			expect(proxyManager.ipUsageCount).toBeInstanceOf(Map);
			expect(proxyManager.currentThreshold).toBe(10);
			expect(proxyManager.lastUsedAccount).toBeNull();
			expect(proxyManager.lastUsedIP).toBeNull();
		});
	});

	describe('parseProxyList', () => {
		it('should parse valid proxy list format', () => {
			const data = `142.111.48.253:7030:user1:pass1
31.59.20.176:6754:user1:pass1
38.170.176.177:5572:user1:pass1`;

			const result = proxyManager.parseProxyList(data);

			expect(result.proxies).toHaveLength(3);
			expect(result.proxies[0]).toEqual({
				ip: '142.111.48.253',
				port: '7030',
			});
			expect(result.proxies[1]).toEqual({
				ip: '31.59.20.176',
				port: '6754',
			});
			expect(result.credentials).toEqual({
				username: 'user1',
				password: 'pass1',
			});
		});

		it('should handle empty lines', () => {
			const data = `142.111.48.253:7030:user1:pass1

31.59.20.176:6754:user1:pass1`;

			const result = proxyManager.parseProxyList(data);

			expect(result.proxies).toHaveLength(2);
		});

		it('should ignore malformed lines', () => {
			const data = `142.111.48.253:7030:user1:pass1
invalid-line
31.59.20.176:6754:user1:pass1`;

			const result = proxyManager.parseProxyList(data);

			expect(result.proxies).toHaveLength(2);
		});
	});

	describe('getRandomProxy (unit test with mock data)', () => {
		beforeEach(() => {
			// Reset proxy manager state for testing
			proxyManager.availableAccounts = [1, 2];
			proxyManager.proxyLists = {
				account1: {
					proxies: [
						{ ip: '1.1.1.1', port: '8001' },
						{ ip: '2.2.2.2', port: '8002' },
					],
					credentials: { username: 'user1', password: 'pass1' },
				},
				account2: {
					proxies: [
						{ ip: '3.3.3.3', port: '8003' },
						{ ip: '4.4.4.4', port: '8004' },
					],
					credentials: { username: 'user2', password: 'pass2' },
				},
			};
			proxyManager.lastFetch = Date.now();
			proxyManager.ipUsageCount.clear();
			proxyManager.currentThreshold = 10;
			proxyManager.lastUsedAccount = null;
			proxyManager.lastUsedIP = null;
		});

		it('should return proxy with required properties', async () => {
			const result = await proxyManager.getRandomProxy();

			expect(result).toHaveProperty('server');
			expect(result).toHaveProperty('username');
			expect(result).toHaveProperty('password');
			expect(result).toHaveProperty('account');
		});

		it('should alternate between accounts', async () => {
			const result1 = await proxyManager.getRandomProxy();
			const result2 = await proxyManager.getRandomProxy();

			expect(result1.account).toBe(1);
			expect(result2.account).toBe(2);
		});

		it('should track IP usage', async () => {
			const result = await proxyManager.getRandomProxy();

			expect(proxyManager.ipUsageCount.get(result.server)).toBe(1);
		});

		it('should avoid consecutive IP reuse', async () => {
			const result1 = await proxyManager.getRandomProxy();
			const result2 = await proxyManager.getRandomProxy();

			expect(result1.server).not.toBe(result2.server);
		});
	});

	describe('Blacklist functionality', () => {
		let originalBlacklist: string | undefined;

		beforeEach(() => {
			// Save original blacklist
			originalBlacklist = process.env.PROXY_BLACKLIST;

			// Reset proxy manager state
			proxyManager.blacklistedIPs = new Set();
		});

		afterEach(() => {
			// Restore original blacklist
			if (originalBlacklist) {
				process.env.PROXY_BLACKLIST = originalBlacklist;
			} else {
				delete process.env.PROXY_BLACKLIST;
			}
			proxyManager.loadBlacklist();
		});

		describe('loadBlacklist', () => {
			it('should load blacklist from environment variable', () => {
				process.env.PROXY_BLACKLIST = '1.1.1.1,2.2.2.2:8080';
				proxyManager.loadBlacklist();

				expect(proxyManager.blacklistedIPs.size).toBe(2);
				expect(proxyManager.blacklistedIPs.has('1.1.1.1')).toBe(true);
				expect(proxyManager.blacklistedIPs.has('2.2.2.2:8080')).toBe(
					true,
				);
			});

			it('should handle empty blacklist', () => {
				delete process.env.PROXY_BLACKLIST;
				proxyManager.loadBlacklist();

				expect(proxyManager.blacklistedIPs.size).toBe(0);
			});

			it('should trim whitespace from entries', () => {
				process.env.PROXY_BLACKLIST = ' 1.1.1.1 , 2.2.2.2:8080 ';
				proxyManager.loadBlacklist();

				expect(proxyManager.blacklistedIPs.has('1.1.1.1')).toBe(true);
				expect(proxyManager.blacklistedIPs.has('2.2.2.2:8080')).toBe(
					true,
				);
			});

			it('should ignore empty entries', () => {
				process.env.PROXY_BLACKLIST = '1.1.1.1,,2.2.2.2:8080,';
				proxyManager.loadBlacklist();

				expect(proxyManager.blacklistedIPs.size).toBe(2);
			});

			it('should handle multiple IP formats', () => {
				process.env.PROXY_BLACKLIST =
					'192.168.1.1,10.0.0.5:8080,172.16.0.1:9000';
				proxyManager.loadBlacklist();

				expect(proxyManager.blacklistedIPs.size).toBe(3);
				expect(proxyManager.blacklistedIPs.has('192.168.1.1')).toBe(
					true,
				);
				expect(proxyManager.blacklistedIPs.has('10.0.0.5:8080')).toBe(
					true,
				);
				expect(proxyManager.blacklistedIPs.has('172.16.0.1:9000')).toBe(
					true,
				);
			});
		});

		describe('isBlacklisted', () => {
			beforeEach(() => {
				process.env.PROXY_BLACKLIST = '1.1.1.1,2.2.2.2:8080';
				proxyManager.loadBlacklist();
			});

			it('should return true for exact IP:port match', () => {
				expect(proxyManager.isBlacklisted('2.2.2.2:8080')).toBe(true);
			});

			it('should return true for IP-only blacklist matching IP:port', () => {
				expect(proxyManager.isBlacklisted('1.1.1.1:8001')).toBe(true);
			});

			it('should return true for exact IP match', () => {
				expect(proxyManager.isBlacklisted('1.1.1.1')).toBe(true);
			});

			it('should return false for non-blacklisted IP', () => {
				expect(proxyManager.isBlacklisted('3.3.3.3:8003')).toBe(false);
			});

			it('should return false for similar but different IP', () => {
				expect(proxyManager.isBlacklisted('1.1.1.2:8001')).toBe(false);
			});

			it('should return false for same IP but different port when port is specified in blacklist', () => {
				expect(proxyManager.isBlacklisted('2.2.2.2:9999')).toBe(false);
			});

			it('should handle empty blacklist', () => {
				proxyManager.blacklistedIPs = new Set();
				expect(proxyManager.isBlacklisted('1.1.1.1:8001')).toBe(false);
			});
		});

		describe('getAllUniqueIPs with blacklist', () => {
			beforeEach(() => {
				// Set up test proxy lists
				proxyManager.availableAccounts = [1, 2];
				proxyManager.proxyLists = {
					account1: {
						proxies: [
							{ ip: '1.1.1.1', port: '8001' },
							{ ip: '2.2.2.2', port: '8002' },
							{ ip: '3.3.3.3', port: '8003' },
						],
						credentials: { username: 'user1', password: 'pass1' },
					},
					account2: {
						proxies: [
							{ ip: '4.4.4.4', port: '8004' },
							{ ip: '5.5.5.5', port: '8005' },
						],
						credentials: { username: 'user2', password: 'pass2' },
					},
				};
			});

			it('should filter out blacklisted IPs', () => {
				process.env.PROXY_BLACKLIST = '1.1.1.1,4.4.4.4:8004';
				proxyManager.loadBlacklist();

				const result = proxyManager.getAllUniqueIPs();

				expect(result).toHaveLength(3);
				expect(
					result.find((p) => p.ip === '1.1.1.1'),
				).toBeUndefined();
				expect(
					result.find((p) => p.ip === '4.4.4.4'),
				).toBeUndefined();
				expect(result.find((p) => p.ip === '2.2.2.2')).toBeDefined();
				expect(result.find((p) => p.ip === '3.3.3.3')).toBeDefined();
				expect(result.find((p) => p.ip === '5.5.5.5')).toBeDefined();
			});

			it('should return all IPs when no blacklist is set', () => {
				delete process.env.PROXY_BLACKLIST;
				proxyManager.loadBlacklist();

				const result = proxyManager.getAllUniqueIPs();

				expect(result).toHaveLength(5);
			});

			it('should return empty array when all IPs are blacklisted', () => {
				process.env.PROXY_BLACKLIST =
					'1.1.1.1,2.2.2.2,3.3.3.3,4.4.4.4,5.5.5.5';
				proxyManager.loadBlacklist();

				const result = proxyManager.getAllUniqueIPs();

				expect(result).toHaveLength(0);
			});

			it('should handle IP-only blacklist matching any port', () => {
				process.env.PROXY_BLACKLIST = '2.2.2.2';
				proxyManager.loadBlacklist();

				const result = proxyManager.getAllUniqueIPs();

				expect(result).toHaveLength(4);
				expect(
					result.find((p) => p.ip === '2.2.2.2'),
				).toBeUndefined();
			});
		});

		describe('getRandomProxy with blacklist', () => {
			beforeEach(() => {
				// Set up test proxy lists
				proxyManager.availableAccounts = [1, 2];
				proxyManager.proxyLists = {
					account1: {
						proxies: [
							{ ip: '1.1.1.1', port: '8001' },
							{ ip: '2.2.2.2', port: '8002' },
							{ ip: '3.3.3.3', port: '8003' },
						],
						credentials: { username: 'user1', password: 'pass1' },
					},
					account2: {
						proxies: [
							{ ip: '4.4.4.4', port: '8004' },
							{ ip: '5.5.5.5', port: '8005' },
						],
						credentials: { username: 'user2', password: 'pass2' },
					},
				};
				proxyManager.lastFetch = Date.now();
				proxyManager.ipUsageCount.clear();
				proxyManager.currentThreshold = 10;
				proxyManager.lastUsedAccount = null;
				proxyManager.lastUsedIP = null;
			});

			it('should never return a blacklisted IP', async () => {
				process.env.PROXY_BLACKLIST = '1.1.1.1,4.4.4.4:8004';
				proxyManager.loadBlacklist();

				// Request multiple proxies to test randomness
				for (let i = 0; i < 10; i++) {
					const result = await proxyManager.getRandomProxy();

					expect(result.server).not.toBe('1.1.1.1:8001');
					expect(result.server).not.toBe('4.4.4.4:8004');
				}
			});

			it('should throw error when all proxies are blacklisted', async () => {
				process.env.PROXY_BLACKLIST =
					'1.1.1.1,2.2.2.2,3.3.3.3,4.4.4.4,5.5.5.5';
				proxyManager.loadBlacklist();

				await expect(proxyManager.getRandomProxy()).rejects.toThrow(
					'No proxies available',
				);
			});

			it('should work normally with partial blacklist', async () => {
				process.env.PROXY_BLACKLIST = '1.1.1.1';
				proxyManager.loadBlacklist();

				const result = await proxyManager.getRandomProxy();

				expect(result).toHaveProperty('server');
				expect(result).toHaveProperty('username');
				expect(result).toHaveProperty('password');
				expect([
					'2.2.2.2:8002',
					'3.3.3.3:8003',
					'4.4.4.4:8004',
					'5.5.5.5:8005',
				]).toContain(result.server);
			});
		});
	});
});
