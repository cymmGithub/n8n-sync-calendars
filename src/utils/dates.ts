import {
	TICKS_PER_MILLISECOND,
	EPOCH_TICKS_AT_UNIX_EPOCH,
} from '../types/index.js';

export const getCurrentDate = (): string => {
	return new Date().toISOString().split('T')[0]!;
};

export const getCurrentDateMidnight = (): string => {
	const now = new Date();
	now.setUTCHours(0, 0, 0, 0);
	return now.toISOString();
};

export const convertTicksToDate = (ticks: bigint | number): Date => {
	const milliseconds = Number(
		(BigInt(ticks) - BigInt(EPOCH_TICKS_AT_UNIX_EPOCH)) /
			BigInt(TICKS_PER_MILLISECOND),
	);
	return new Date(milliseconds);
};

export const formatTime = (date: Date): string => {
	const hours = String(date.getUTCHours()).padStart(2, '0');
	const minutes = String(date.getUTCMinutes()).padStart(2, '0');
	return `${hours}:${minutes}`;
};

export function isoToTicks(isoString: string): bigint {
	// Remove timezone info if present and parse as local time
	const cleanIsoString = isoString.replace(/[+-]\d{2}:\d{2}$|Z$/, '');
	const date = new Date(cleanIsoString);

	// Ensure we're working with valid date
	if (isNaN(date.getTime())) {
		throw new Error(`Invalid ISO string: ${isoString}`);
	}

	const ms = BigInt(date.getTime());
	return (
		ms * BigInt(TICKS_PER_MILLISECOND) + BigInt(EPOCH_TICKS_AT_UNIX_EPOCH)
	);
}

export const getTimeSlotIndex = (
	timeString: string | null | undefined,
	date: Date | null | undefined,
): number => {
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

export const getReservationsFromNowUrl = (): string => {
	const reservationsBaseUrl = process.env['OPONEO_RESERVATIONS_LIST_URL'];
	const jsNow = new Date();
	const dotNetNow =
		jsNow.getTime() * TICKS_PER_MILLISECOND + EPOCH_TICKS_AT_UNIX_EPOCH;
	console.log('dot_net_now', dotNetNow);

	return `${reservationsBaseUrl}?data-od=${dotNetNow}`;
};
