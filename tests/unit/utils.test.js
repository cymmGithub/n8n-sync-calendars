const {
	convertTicksToDate,
	formatTime,
	isoToTicks,
	getCurrentDate,
	get_reservations_from_now_url,
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
});
