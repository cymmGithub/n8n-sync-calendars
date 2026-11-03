import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface WorkflowNode {
	name: string;
	type: string;
	parameters: {
		jsCode?: string;
		rule?: { interval: { expression?: string }[] };
	};
}

const workflow = JSON.parse(
	readFileSync(
		join(__dirname, '../../workflows/syncer_ WO =_ OPONEO.json'),
		'utf8',
	),
) as { nodes: WorkflowNode[] };

const node = (name: string): WorkflowNode => {
	const found = workflow.nodes.find((n) => n.name === name);
	if (!found) throw new Error(`Node "${name}" not found`);
	return found;
};

// Runs a Code node's jsCode with one input item and the outputs of earlier
// nodes, which the node reads with $items(name)
const runCode = (
	name: string,
	json: Record<string, unknown>,
	earlier: Record<string, Record<string, unknown>> = {},
) => {
	const $input = { first: () => ({ json }), all: () => [{ json }] };
	const $items = (nodeName: string) => [{ json: earlier[nodeName] }];
	// eslint-disable-next-line @typescript-eslint/no-implied-eval -- running the workflow's own code is the point
	return new Function('$input', '$items', node(name).parameters.jsCode ?? '')(
		$input,
		$items,
	) as unknown[];
};

// Redis value written once a WO event got its block in Oponeo. Times are the
// Warsaw wall clock written as UTC: "T14:00:00.000Z" is 14:00 in Warsaw.
const syncedBlock = (
	oponeoReservationId: string,
	startTime: string,
	endTime: string,
) =>
	JSON.stringify({
		oponeoReservationId,
		startTime,
		endTime,
		lastSeen: '2026-11-03T07:00:00.000Z',
	});

// A WO event as it reaches the nodes after "Reservation Splitter2"
const woEvent = (
	id: number,
	startDate: string,
	endDate: string,
	redisValue?: string,
) => ({
	id,
	phoneNumber: '500600700',
	licencePlate: 'TEST123',
	startDate,
	endDate,
	redisValue,
});

describe('syncer: WO => OPONEO workflow', () => {
	beforeEach(() => {
		jest.spyOn(console, 'log').mockImplementation(() => undefined);
		// Tuesday 11:45 in Warsaw
		jest.useFakeTimers().setSystemTime(new Date('2026-11-03T10:45:00Z'));
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	describe('Prepare data for Oponeo2', () => {
		it('sends only events that are new or moved since they were synced', () => {
			const result = runCode('Prepare data for Oponeo2', {
				withinHoursReservations: [
					woEvent(1, '2026-11-09T14:00:00+01:00', '2026-11-09T15:00:00+01:00'),
					woEvent(
						2,
						'2026-11-09T16:00:00+01:00',
						'2026-11-09T17:00:00+01:00',
						syncedBlock(
							'2900002',
							'2026-11-09T16:00:00.000Z',
							'2026-11-09T17:00:00.000Z',
						),
					),
					woEvent(
						3,
						'2026-11-10T09:00:00+01:00',
						'2026-11-10T10:00:00+01:00',
						syncedBlock(
							'2900003',
							'2026-11-09T09:00:00.000Z',
							'2026-11-09T10:00:00.000Z',
						),
					),
				],
			}) as { json: { reservations: { woReservationId: number }[] } }[];

			expect(
				result[0]?.json.reservations.map((r) => r.woReservationId),
			).toEqual([1, 3]);
		});
	});

	describe('Code (moved bookings)', () => {
		it('frees the old slot of a moved booking only while it can still be booked', () => {
			const result = runCode('Code', {
				withinHoursReservations: [
					// moved away from tomorrow 10:00
					woEvent(
						1,
						'2026-11-06T10:00:00+01:00',
						'2026-11-06T11:00:00+01:00',
						syncedBlock(
							'2900001',
							'2026-11-04T10:00:00.000Z',
							'2026-11-04T11:00:00.000Z',
						),
					),
					// moved away from 11:30 today, which has already started
					woEvent(
						2,
						'2026-11-07T09:00:00+01:00',
						'2026-11-07T10:00:00+01:00',
						syncedBlock(
							'2900002',
							'2026-11-03T11:30:00.000Z',
							'2026-11-03T12:30:00.000Z',
						),
					),
					// not moved
					woEvent(
						3,
						'2026-11-05T10:00:00+01:00',
						'2026-11-05T11:00:00+01:00',
						syncedBlock(
							'2900003',
							'2026-11-05T10:00:00.000Z',
							'2026-11-05T11:00:00.000Z',
						),
					),
				],
			});

			expect(result).toEqual([{ json: { oponeoReservationIds: ['2900001'] } }]);
		});

		it('keeps the old block while the new time still overlaps it', () => {
			// 10:00-11:00 extended to 12:00: the old block goes before the new
			// one is created, so a failed create would leave 10:00 bookable
			const result = runCode('Code', {
				withinHoursReservations: [
					woEvent(
						1,
						'2026-11-05T10:00:00+01:00',
						'2026-11-05T12:00:00+01:00',
						syncedBlock(
							'2900001',
							'2026-11-05T10:00:00.000Z',
							'2026-11-05T11:00:00.000Z',
						),
					),
				],
			});

			expect(result).toEqual([]);
		});
	});

	describe('Code in JavaScript (bookings gone from WO)', () => {
		const blocks = {
			'WO:1': syncedBlock(
				'2900001',
				'2026-11-05T10:00:00.000Z',
				'2026-11-05T11:00:00.000Z',
			),
			// tomorrow 10:00
			'WO:2': syncedBlock(
				'2900002',
				'2026-11-04T10:00:00.000Z',
				'2026-11-04T11:00:00.000Z',
			),
			// 11:30 today: started, WO drops bookings that are in progress
			'WO:3': syncedBlock(
				'2900003',
				'2026-11-03T11:30:00.000Z',
				'2026-11-03T13:30:00.000Z',
			),
			// 13:30 today: less than 2 hours ahead
			'WO:4': syncedBlock(
				'2900004',
				'2026-11-03T13:30:00.000Z',
				'2026-11-03T14:30:00.000Z',
			),
			// yesterday
			'WO:5': syncedBlock(
				'2900005',
				'2026-11-02T09:00:00.000Z',
				'2026-11-02T10:00:00.000Z',
			),
		};
		const goneFromWo = (woList: { total: number; items: { id: number }[] }) =>
			runCode(
				'Code in JavaScript',
				{},
				{
					'Get WO Events (date_from)': { data: woList },
					'Current Redis Records': blocks,
				},
			);

		it('frees only slots that have not started and are over 2 hours ahead', () => {
			expect(goneFromWo({ total: 1, items: [{ id: 1 }] })).toEqual([
				{ woId: 2, oponeoReservationIds: ['2900002'] },
				{ woId: 3, oponeoReservationIds: [] },
				{ woId: 4, oponeoReservationIds: [] },
				{ woId: 5, oponeoReservationIds: [] },
			]);
		});

		it.each([
			['a partial list', { total: 2, items: [{ id: 1 }] }],
			['an empty list', { total: 0, items: [] }],
		])('touches nothing when WO returns %s', (_, woList) => {
			expect(goneFromWo(woList)).toEqual([]);
		});

		it('measures the 2 hours on the Warsaw clock in summer too', () => {
			// 11:45 in Warsaw (UTC+2)
			jest.setSystemTime(new Date('2026-07-01T09:45:00Z'));

			const result = runCode(
				'Code in JavaScript',
				{},
				{
					'Get WO Events (date_from)': {
						data: { total: 1, items: [{ id: 1 }] },
					},
					'Current Redis Records': {
						// 13:15, 1.5h ahead
						'WO:2': syncedBlock(
							'2900002',
							'2026-07-01T13:15:00.000Z',
							'2026-07-01T14:15:00.000Z',
						),
						// 14:00, 2.25h ahead
						'WO:3': syncedBlock(
							'2900003',
							'2026-07-01T14:00:00.000Z',
							'2026-07-01T15:00:00.000Z',
						),
					},
				},
			);

			expect(result).toEqual([
				{ woId: 2, oponeoReservationIds: [] },
				{ woId: 3, oponeoReservationIds: ['2900003'] },
			]);
		});
	});

	it('runs every evening at 23:00, Sunday included', () => {
		const expressions = workflow.nodes
			.filter((n) => n.type === 'n8n-nodes-base.scheduleTrigger')
			.flatMap((n) => n.parameters.rule?.interval ?? [])
			.map((rule) => rule.expression);

		expect(expressions).toContain('0 23 * * *');
	});
});
