const {
	convertTicksToDate,
	formatTime,
	isoToTicks,
	getCurrentDate,
	get_reservations_from_now_url,
	getTimeSlotIndex,
	getRandomProxyConfig,
	TICKS_PER_MILLISECOND,
	EPOCH_TICKS_AT_UNIX_EPOCH,
} = require('../../utils');

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

	describe('getRandomProxyConfig', () => {
		describe('Return value structure', () => {
			it('should return an object with port and account properties', () => {
				const result = getRandomProxyConfig();

				expect(result).toHaveProperty('port');
				expect(result).toHaveProperty('account');
			});

			it('should return numeric values for both properties', () => {
				const result = getRandomProxyConfig();

				expect(typeof result.port).toBe('number');
				expect(typeof result.account).toBe('number');
			});
		});

		describe('Port validation', () => {
			it('should return a port from the available ports list', () => {
				const validPorts = [8001, 8002, 8003, 8004, 8005];
				const result = getRandomProxyConfig();

				expect(validPorts).toContain(result.port);
			});

			it('should always return a valid port over multiple calls', () => {
				const validPorts = [8001, 8002, 8003, 8004, 8005];

				for (let i = 0; i < 20; i++) {
					const result = getRandomProxyConfig();
					expect(validPorts).toContain(result.port);
				}
			});
		});

		describe('Account validation', () => {
			it('should return account 1 or 2', () => {
				const result = getRandomProxyConfig();

				expect([1, 2]).toContain(result.account);
			});

			it('should always return a valid account over multiple calls', () => {
				for (let i = 0; i < 20; i++) {
					const result = getRandomProxyConfig();
					expect([1, 2]).toContain(result.account);
				}
			});
		});

		describe('Randomness distribution', () => {
			it('should distribute ports across multiple calls', () => {
				const portCounts = {};
				const iterations = 100;

				for (let i = 0; i < iterations; i++) {
					const result = getRandomProxyConfig();
					portCounts[result.port] = (portCounts[result.port] || 0) + 1;
				}

				// With 100 iterations and 5 ports, we expect at least 2 different ports
				const uniquePorts = Object.keys(portCounts);
				expect(uniquePorts.length).toBeGreaterThanOrEqual(2);
			});

			it('should distribute accounts across multiple calls', () => {
				const accountCounts = {};
				const iterations = 100;

				for (let i = 0; i < iterations; i++) {
					const result = getRandomProxyConfig();
					accountCounts[result.account] = (accountCounts[result.account] || 0) + 1;
				}

				// With 100 iterations and 2 accounts, both should appear
				expect(accountCounts[1]).toBeGreaterThan(0);
				expect(accountCounts[2]).toBeGreaterThan(0);
			});

			it('should produce different combinations over multiple calls', () => {
				const combinations = new Set();
				const iterations = 50;

				for (let i = 0; i < iterations; i++) {
					const result = getRandomProxyConfig();
					combinations.add(`${result.port}-${result.account}`);
				}

				// With 5 ports and 2 accounts, we should get multiple combinations
				expect(combinations.size).toBeGreaterThanOrEqual(3);
			});
		});

		describe('Independence of port and account selection', () => {
			it('should independently select port and account', () => {
				const results = [];

				for (let i = 0; i < 100; i++) {
					results.push(getRandomProxyConfig());
				}

				// Check that each account appears with different ports
				const account1Ports = new Set(
					results.filter(r => r.account === 1).map(r => r.port)
				);
				const account2Ports = new Set(
					results.filter(r => r.account === 2).map(r => r.port)
				);

				// Both accounts should appear with multiple different ports
				expect(account1Ports.size).toBeGreaterThan(1);
				expect(account2Ports.size).toBeGreaterThan(1);
			});
		});
	});
});
