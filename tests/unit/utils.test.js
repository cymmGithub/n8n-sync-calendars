const {
	convertTicksToDate,
	formatTime,
	isoToTicks,
	getCurrentDate,
	getCurrentDateMidnight,
	get_reservations_from_now_url,
	getTimeSlotIndex,
	proxyManager,
	TICKS_PER_MILLISECOND,
	EPOCH_TICKS_AT_UNIX_EPOCH,
} = require('../../utils');
const moment = require('moment');

describe('Date and Time Utilities', () => {
	describe('getCurrentDate', () => {
		it('should return current date in YYYY-MM-DD format', () => {
			const result = getCurrentDate();
			const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
			expect(result).toMatch(dateRegex);
		});

		it('should return today\'s date', () => {
			const result = getCurrentDate();
			const expected = new Date().toISOString().split('T')[0];
			expect(result).toBe(expected);
		});
	});

	describe('getCurrentDateMidnight', () => {
		it('should return ISO 8601 formatted string', () => {
			const result = getCurrentDateMidnight();
			// ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
			const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
			expect(result).toMatch(isoRegex);
		});

		it('should return time set to midnight (00:00:00.000)', () => {
			const result = getCurrentDateMidnight();
			const date = new Date(result);

			expect(date.getUTCHours()).toBe(0);
			expect(date.getUTCMinutes()).toBe(0);
			expect(date.getUTCSeconds()).toBe(0);
			expect(date.getUTCMilliseconds()).toBe(0);
		});

		it('should return today\'s date at midnight', () => {
			const result = getCurrentDateMidnight();
			const resultDate = new Date(result);
			const today = new Date();

			// Compare year, month, and date (ignoring time)
			expect(resultDate.getUTCFullYear()).toBe(today.getUTCFullYear());
			expect(resultDate.getUTCMonth()).toBe(today.getUTCMonth());
			expect(resultDate.getUTCDate()).toBe(today.getUTCDate());
		});

	it('should match moment.utc().startOf(\'day\').toISOString() output', () => {
		const result = getCurrentDateMidnight();
		const expected = moment.utc().startOf('day').toISOString();

		expect(result).toBe(expected);
	});

		it('should be parseable as a valid Date object', () => {
			const result = getCurrentDateMidnight();
			const date = new Date(result);

			expect(date).toBeInstanceOf(Date);
			expect(isNaN(date.getTime())).toBe(false);
		});

		it('should have timezone indicator Z', () => {
			const result = getCurrentDateMidnight();
			expect(result).toMatch(/Z$/);
		});

		it('should be different from current time (unless it is exactly midnight)', () => {
			const result = getCurrentDateMidnight();
			const now = new Date().toISOString();

			const resultDate = new Date(result);
			const nowDate = new Date(now);

			// Unless we're exactly at midnight, these should be different
			if (nowDate.getUTCHours() !== 0 || nowDate.getUTCMinutes() !== 0) {
				expect(result).not.toBe(now);
			}
		});

		it('should always be less than or equal to current time', () => {
			const result = getCurrentDateMidnight();
			const now = new Date();
			const resultDate = new Date(result);

			expect(resultDate.getTime()).toBeLessThanOrEqual(now.getTime());
		});

		it('should be consistent across multiple calls within the same day', () => {
			const result1 = getCurrentDateMidnight();
			const result2 = getCurrentDateMidnight();

			// Both should return the same midnight timestamp if called on the same day
			expect(result1).toBe(result2);
		});

	it('should return time exactly 24 hours before tomorrow\'s midnight', () => {
		const today = getCurrentDateMidnight();
		const tomorrow = moment.utc().add(1, 'day').startOf('day').toISOString();

		const todayTime = new Date(today).getTime();
		const tomorrowTime = new Date(tomorrow).getTime();

		expect(tomorrowTime - todayTime).toBe(24 * 60 * 60 * 1000); // 24 hours in milliseconds
	});
	});

	describe('convertTicksToDate', () => {
		it('should convert .NET ticks to JavaScript Date', () => {
			// .NET ticks for 2025-01-15 12:00:00 UTC
			// Correct calculation: Date.UTC(2025, 0, 15, 12, 0, 0) = 1736942400000 ms
			// Ticks = 1736942400000 * 10000 + 621355968000000000 = 638725392000000000
			const ticks = 638725392000000000n;
			const result = convertTicksToDate(ticks);

			expect(result).toBeInstanceOf(Date);
			expect(result.getUTCFullYear()).toBe(2025);
			expect(result.getUTCMonth()).toBe(0); // January (0-indexed)
			expect(result.getUTCDate()).toBe(15);
		});

		it('should handle Unix epoch correctly', () => {
			const result = convertTicksToDate(EPOCH_TICKS_AT_UNIX_EPOCH);
			expect(result.getTime()).toBe(0);
		});

		it('should convert ticks to correct milliseconds', () => {
			const testTicks = 638000000000000000n;
			const result = convertTicksToDate(testTicks);

			const expectedMs = Number((testTicks - BigInt(EPOCH_TICKS_AT_UNIX_EPOCH)) / BigInt(TICKS_PER_MILLISECOND));
			expect(result.getTime()).toBe(expectedMs);
		});
	});

	describe('formatTime', () => {
		it('should format time as HH:MM', () => {
			const date = new Date('2025-01-15T14:30:00Z');
			const result = formatTime(date);
			expect(result).toBe('14:30');
		});

		it('should pad single digit hours with zero', () => {
			const date = new Date('2025-01-15T09:05:00Z');
			const result = formatTime(date);
			expect(result).toBe('09:05');
		});

		it('should pad single digit minutes with zero', () => {
			const date = new Date('2025-01-15T14:05:00Z');
			const result = formatTime(date);
			expect(result).toBe('14:05');
		});

		it('should handle midnight correctly', () => {
			const date = new Date('2025-01-15T00:00:00Z');
			const result = formatTime(date);
			expect(result).toBe('00:00');
		});

		it('should handle end of day correctly', () => {
			const date = new Date('2025-01-15T23:59:00Z');
			const result = formatTime(date);
			expect(result).toBe('23:59');
		});
	});

	describe('isoToTicks', () => {
		it('should convert ISO string to .NET ticks', () => {
			const isoString = '2025-01-15T12:00:00';
			const result = isoToTicks(isoString);

			expect(typeof result).toBe('bigint');
			expect(result > BigInt(EPOCH_TICKS_AT_UNIX_EPOCH)).toBe(true);
		});

		it('should handle ISO string with timezone', () => {
			const isoString = '2025-01-15T12:00:00+02:00';
			const result = isoToTicks(isoString);

			expect(typeof result).toBe('bigint');
		});

		it('should handle ISO string with Z timezone', () => {
			const isoString = '2025-01-15T12:00:00Z';
			const result = isoToTicks(isoString);

			expect(typeof result).toBe('bigint');
		});

		it('should throw error for invalid ISO string', () => {
			const invalidIsoString = 'not-a-date';
			expect(() => isoToTicks(invalidIsoString)).toThrow('Invalid ISO string');
		});

		it('should be reversible with convertTicksToDate', () => {
			const originalIsoString = '2025-01-15T12:00:00';
			const ticks = isoToTicks(originalIsoString);
			const dateBack = convertTicksToDate(ticks);

			// Compare the dates (allowing for timezone differences)
			const originalDate = new Date(originalIsoString.replace(/[+-]\d{2}:\d{2}$|Z$/, ''));
			expect(Math.abs(dateBack.getTime() - originalDate.getTime())).toBeLessThan(1000); // Within 1 second
		});
	});

	describe('get_reservations_from_now_url', () => {
		beforeEach(() => {
			// Set environment variable for testing
			process.env.OPONEO_RESERVATIONS_LIST_URL = 'https://autoserwis.oponeo.pl/reservations';
		});

		afterEach(() => {
			delete process.env.OPONEO_RESERVATIONS_LIST_URL;
		});

		it('should return URL with current date as .NET ticks', () => {
			const result = get_reservations_from_now_url();

			expect(result).toContain('https://autoserwis.oponeo.pl/reservations');
			expect(result).toContain('?data-od=');
		});

		it('should include ticks parameter in URL', () => {
			const result = get_reservations_from_now_url();
			const ticksMatch = result.match(/\?data-od=(\d+)/);

			expect(ticksMatch).not.toBeNull();
			expect(ticksMatch[1]).toBeTruthy();

			const ticks = BigInt(ticksMatch[1]);
			expect(ticks > BigInt(EPOCH_TICKS_AT_UNIX_EPOCH)).toBe(true);
		});

		it('should generate URL with current timestamp', () => {
			const beforeTime = Date.now();
			const result = get_reservations_from_now_url();
			const afterTime = Date.now();

			const ticksMatch = result.match(/\?data-od=(\d+)/);
			const ticks = BigInt(ticksMatch[1]);

			// Convert ticks back to milliseconds
			const msFromTicks = Number((ticks - BigInt(EPOCH_TICKS_AT_UNIX_EPOCH)) / BigInt(TICKS_PER_MILLISECOND));

			// Should be between before and after times
			expect(msFromTicks).toBeGreaterThanOrEqual(beforeTime - 1000);
			expect(msFromTicks).toBeLessThanOrEqual(afterTime + 1000);
		});
	});

	describe('Constants', () => {
		it('should have correct TICKS_PER_MILLISECOND', () => {
			expect(TICKS_PER_MILLISECOND).toBe(10_000);
		});

		it('should have correct EPOCH_TICKS_AT_UNIX_EPOCH', () => {
			expect(EPOCH_TICKS_AT_UNIX_EPOCH).toBe(621_355_968_000_000_000);
		});
	});

	describe('Round-trip conversions', () => {
		it('should correctly convert Date -> Ticks -> Date', () => {
			// Use UTC time to avoid timezone issues
			const originalDate = new Date('2025-06-15T14:30:00Z');
			const isoString = originalDate.toISOString();
			const ticks = isoToTicks(isoString);
			const convertedDate = convertTicksToDate(ticks);

			// The isoToTicks function strips timezone and treats as local time
			// So we need to account for timezone offset
			const timezoneOffsetMs = originalDate.getTimezoneOffset() * 60 * 1000;
			expect(Math.abs(convertedDate.getTime() - originalDate.getTime() - timezoneOffsetMs)).toBeLessThan(1000);
		});

		it('should handle multiple conversions without loss', () => {
			const dates = [
				'2025-01-01T00:00:00Z',
				'2025-06-15T12:30:45Z',
				'2025-12-31T23:59:59Z',
			];

			dates.forEach(dateStr => {
				const ticks = isoToTicks(dateStr);
				const dateBack = convertTicksToDate(ticks);
				const originalDate = new Date(dateStr);

				// Account for timezone offset since isoToTicks treats as local time
				const timezoneOffsetMs = originalDate.getTimezoneOffset() * 60 * 1000;
				expect(Math.abs(dateBack.getTime() - originalDate.getTime() - timezoneOffsetMs)).toBeLessThan(1000);
			});
		});
	});

	describe('getTimeSlotIndex', () => {
		describe('17:00 time slot', () => {
			it('should return 0 for 17:00 on Monday', () => {
				// Monday, October 20, 2025
				const date = new Date('2025-10-20T17:00:00');
				const result = getTimeSlotIndex('17:00', date);
				expect(result).toBe(0);
			});

			it('should return 0 for 17:00 on Tuesday', () => {
				// Tuesday, October 21, 2025
				const date = new Date('2025-10-21T17:00:00');
				const result = getTimeSlotIndex('17:00', date);
				expect(result).toBe(0);
			});

			it('should return 0 for 17:00 on Wednesday', () => {
				// Wednesday, October 22, 2025
				const date = new Date('2025-10-22T17:00:00');
				const result = getTimeSlotIndex('17:00', date);
				expect(result).toBe(0);
			});

			it('should return 0 for 17:00 on Thursday', () => {
				// Thursday, October 23, 2025
				const date = new Date('2025-10-23T17:00:00');
				const result = getTimeSlotIndex('17:00', date);
				expect(result).toBe(0);
			});

			it('should return 0 for 17:00 on Friday', () => {
				// Friday, October 24, 2025
				const date = new Date('2025-10-24T17:00:00');
				const result = getTimeSlotIndex('17:00', date);
				expect(result).toBe(0);
			});

			it('should return 0 for 17:00 on Saturday', () => {
				// Saturday, October 18, 2025
				const date = new Date('2025-10-18T17:00:00');
				const result = getTimeSlotIndex('17:00', date);
				expect(result).toBe(0);
			});

			it('should return 0 for 17:00 on Sunday', () => {
				// Sunday, October 19, 2025
				const date = new Date('2025-10-19T17:00:00');
				const result = getTimeSlotIndex('17:00', date);
				expect(result).toBe(0);
			});
		});

		describe('14:00 time slot', () => {
			it('should return 0 for 14:00 on Saturday', () => {
				// Saturday, October 18, 2025 (getDay() returns 6)
				const date = new Date('2025-10-18T14:00:00');
				expect(date.getDay()).toBe(6); // Verify it's Saturday
				const result = getTimeSlotIndex('14:00', date);
				expect(result).toBe(0);
			});

			it('should return 1 for 14:00 on Monday', () => {
				// Monday, October 20, 2025
				const date = new Date('2025-10-20T14:00:00');
				expect(date.getDay()).toBe(1); // Verify it's Monday
				const result = getTimeSlotIndex('14:00', date);
				expect(result).toBe(1);
			});

			it('should return 1 for 14:00 on Tuesday', () => {
				// Tuesday, October 21, 2025
				const date = new Date('2025-10-21T14:00:00');
				const result = getTimeSlotIndex('14:00', date);
				expect(result).toBe(1);
			});

			it('should return 1 for 14:00 on Wednesday', () => {
				// Wednesday, October 22, 2025
				const date = new Date('2025-10-22T14:00:00');
				const result = getTimeSlotIndex('14:00', date);
				expect(result).toBe(1);
			});

			it('should return 1 for 14:00 on Thursday', () => {
				// Thursday, October 23, 2025
				const date = new Date('2025-10-23T14:00:00');
				const result = getTimeSlotIndex('14:00', date);
				expect(result).toBe(1);
			});

			it('should return 1 for 14:00 on Friday', () => {
				// Friday, October 24, 2025
				const date = new Date('2025-10-24T14:00:00');
				const result = getTimeSlotIndex('14:00', date);
				expect(result).toBe(1);
			});

			it('should return 1 for 14:00 on Sunday', () => {
				// Sunday, October 19, 2025
				const date = new Date('2025-10-19T14:00:00');
				expect(date.getDay()).toBe(0); // Verify it's Sunday
				const result = getTimeSlotIndex('14:00', date);
				expect(result).toBe(1);
			});
		});

		describe('Other time slots', () => {
			it('should return 1 for 10:00 on any day', () => {
				const date = new Date('2025-10-20T10:00:00');
				const result = getTimeSlotIndex('10:00', date);
				expect(result).toBe(1);
			});

			it('should return 1 for 12:30 on any day', () => {
				const date = new Date('2025-10-20T12:30:00');
				const result = getTimeSlotIndex('12:30', date);
				expect(result).toBe(1);
			});

			it('should return 1 for 15:45 on any day', () => {
				const date = new Date('2025-10-20T15:45:00');
				const result = getTimeSlotIndex('15:45', date);
				expect(result).toBe(1);
			});

			it('should return 1 for 18:00 on any day', () => {
				const date = new Date('2025-10-20T18:00:00');
				const result = getTimeSlotIndex('18:00', date);
				expect(result).toBe(1);
			});

			it('should return 1 for 09:00 on Saturday', () => {
				const date = new Date('2025-10-18T09:00:00');
				expect(date.getDay()).toBe(6); // Verify it's Saturday
				const result = getTimeSlotIndex('09:00', date);
				expect(result).toBe(1);
			});
		});

		describe('Error handling', () => {
			it('should throw error when timeString is missing', () => {
				const date = new Date('2025-10-20T14:00:00');
				expect(() => getTimeSlotIndex(null, date)).toThrow('Both timeString and date are required');
			});

			it('should throw error when timeString is undefined', () => {
				const date = new Date('2025-10-20T14:00:00');
				expect(() => getTimeSlotIndex(undefined, date)).toThrow('Both timeString and date are required');
			});

			it('should throw error when timeString is empty string', () => {
				const date = new Date('2025-10-20T14:00:00');
				expect(() => getTimeSlotIndex('', date)).toThrow('Both timeString and date are required');
			});

			it('should throw error when date is missing', () => {
				expect(() => getTimeSlotIndex('14:00', null)).toThrow('Both timeString and date are required');
			});

			it('should throw error when date is undefined', () => {
				expect(() => getTimeSlotIndex('14:00', undefined)).toThrow('Both timeString and date are required');
			});

			it('should throw error when both parameters are missing', () => {
				expect(() => getTimeSlotIndex(null, null)).toThrow('Both timeString and date are required');
			});
		});

		describe('Edge cases', () => {
			it('should handle date at midnight on Saturday', () => {
				const date = new Date('2025-10-18T00:00:00');
				expect(date.getDay()).toBe(6); // Verify it's Saturday
				const result = getTimeSlotIndex('14:00', date);
				expect(result).toBe(0);
			});

			it('should handle date at end of day on Saturday', () => {
				const date = new Date('2025-10-18T23:59:59');
				expect(date.getDay()).toBe(6); // Verify it's Saturday
				const result = getTimeSlotIndex('14:00', date);
				expect(result).toBe(0);
			});

			it('should treat 14:00 on different Saturdays consistently', () => {
				// Test multiple Saturdays
				const saturdays = [
					new Date('2025-10-18T14:00:00'), // October
					new Date('2025-11-15T14:00:00'), // November
					new Date('2025-12-20T14:00:00'), // December
				];

				saturdays.forEach(date => {
					expect(date.getDay()).toBe(6); // Verify it's Saturday
					const result = getTimeSlotIndex('14:00', date);
					expect(result).toBe(0);
				});
			});
		});
	});

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
				expect(result.proxies[0]).toEqual({ ip: '142.111.48.253', port: '7030' });
				expect(result.proxies[1]).toEqual({ ip: '31.59.20.176', port: '6754' });
				expect(result.credentials).toEqual({ username: 'user1', password: 'pass1' });
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
				proxyManager.proxyLists = {
					account1: {
						proxies: [
							{ ip: '1.1.1.1', port: '8001' },
							{ ip: '2.2.2.2', port: '8002' },
						],
						credentials: { username: 'user1', password: 'pass1' }
					},
					account2: {
						proxies: [
							{ ip: '3.3.3.3', port: '8003' },
							{ ip: '4.4.4.4', port: '8004' },
						],
						credentials: { username: 'user2', password: 'pass2' }
					}
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
			let originalBlacklist;

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
					expect(proxyManager.blacklistedIPs.has('2.2.2.2:8080')).toBe(true);
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
					expect(proxyManager.blacklistedIPs.has('2.2.2.2:8080')).toBe(true);
				});

				it('should ignore empty entries', () => {
					process.env.PROXY_BLACKLIST = '1.1.1.1,,2.2.2.2:8080,';
					proxyManager.loadBlacklist();

					expect(proxyManager.blacklistedIPs.size).toBe(2);
				});

				it('should handle multiple IP formats', () => {
					process.env.PROXY_BLACKLIST = '192.168.1.1,10.0.0.5:8080,172.16.0.1:9000';
					proxyManager.loadBlacklist();

					expect(proxyManager.blacklistedIPs.size).toBe(3);
					expect(proxyManager.blacklistedIPs.has('192.168.1.1')).toBe(true);
					expect(proxyManager.blacklistedIPs.has('10.0.0.5:8080')).toBe(true);
					expect(proxyManager.blacklistedIPs.has('172.16.0.1:9000')).toBe(true);
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
					proxyManager.proxyLists = {
						account1: {
							proxies: [
								{ ip: '1.1.1.1', port: '8001' },
								{ ip: '2.2.2.2', port: '8002' },
								{ ip: '3.3.3.3', port: '8003' },
							],
							credentials: { username: 'user1', password: 'pass1' }
						},
						account2: {
							proxies: [
								{ ip: '4.4.4.4', port: '8004' },
								{ ip: '5.5.5.5', port: '8005' },
							],
							credentials: { username: 'user2', password: 'pass2' }
						}
					};
				});

				it('should filter out blacklisted IPs', () => {
					process.env.PROXY_BLACKLIST = '1.1.1.1,4.4.4.4:8004';
					proxyManager.loadBlacklist();

					const result = proxyManager.getAllUniqueIPs();

					expect(result).toHaveLength(3);
					expect(result.find(p => p.ip === '1.1.1.1')).toBeUndefined();
					expect(result.find(p => p.ip === '4.4.4.4')).toBeUndefined();
					expect(result.find(p => p.ip === '2.2.2.2')).toBeDefined();
					expect(result.find(p => p.ip === '3.3.3.3')).toBeDefined();
					expect(result.find(p => p.ip === '5.5.5.5')).toBeDefined();
				});

				it('should return all IPs when no blacklist is set', () => {
					delete process.env.PROXY_BLACKLIST;
					proxyManager.loadBlacklist();

					const result = proxyManager.getAllUniqueIPs();

					expect(result).toHaveLength(5);
				});

				it('should return empty array when all IPs are blacklisted', () => {
					process.env.PROXY_BLACKLIST = '1.1.1.1,2.2.2.2,3.3.3.3,4.4.4.4,5.5.5.5';
					proxyManager.loadBlacklist();

					const result = proxyManager.getAllUniqueIPs();

					expect(result).toHaveLength(0);
				});

				it('should handle IP-only blacklist matching any port', () => {
					process.env.PROXY_BLACKLIST = '2.2.2.2';
					proxyManager.loadBlacklist();

					const result = proxyManager.getAllUniqueIPs();

					expect(result).toHaveLength(4);
					expect(result.find(p => p.ip === '2.2.2.2')).toBeUndefined();
				});
			});

			describe('getRandomProxy with blacklist', () => {
				beforeEach(() => {
					// Set up test proxy lists
					proxyManager.proxyLists = {
						account1: {
							proxies: [
								{ ip: '1.1.1.1', port: '8001' },
								{ ip: '2.2.2.2', port: '8002' },
								{ ip: '3.3.3.3', port: '8003' },
							],
							credentials: { username: 'user1', password: 'pass1' }
						},
						account2: {
							proxies: [
								{ ip: '4.4.4.4', port: '8004' },
								{ ip: '5.5.5.5', port: '8005' },
							],
							credentials: { username: 'user2', password: 'pass2' }
						}
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
					process.env.PROXY_BLACKLIST = '1.1.1.1,2.2.2.2,3.3.3.3,4.4.4.4,5.5.5.5';
					proxyManager.loadBlacklist();

					await expect(proxyManager.getRandomProxy()).rejects.toThrow('No proxies available');
				});

				it('should work normally with partial blacklist', async () => {
					process.env.PROXY_BLACKLIST = '1.1.1.1';
					proxyManager.loadBlacklist();

					const result = await proxyManager.getRandomProxy();

					expect(result).toHaveProperty('server');
					expect(result).toHaveProperty('username');
					expect(result).toHaveProperty('password');
					expect(['2.2.2.2:8002', '3.3.3.3:8003', '4.4.4.4:8004', '5.5.5.5:8005']).toContain(result.server);
				});
			});
		});
	});
});
