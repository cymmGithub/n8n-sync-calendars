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

// Runs a Code node's jsCode with a single input item
const runCode = (name: string, json: Record<string, unknown>) => {
	const $input = { first: () => ({ json }), all: () => [{ json }] };
	// eslint-disable-next-line @typescript-eslint/no-implied-eval -- running the workflow's own code is the point
	return new Function('$input', node(name).parameters.jsCode ?? '')($input) as {
		json: Record<string, unknown>;
	}[];
};

// A WO event as it reaches "Prepare data for Oponeo2". redisValue is set once
// the event has a block in Oponeo, with times stored as Warsaw wall clock + Z.
const woEvent = (
	id: number,
	startDate: string,
	endDate: string,
	synced?: { startTime: string; endTime: string },
) => ({
	id,
	phoneNumber: '500600700',
	licencePlate: 'TEST123',
	startDate,
	endDate,
	redisValue:
		synced &&
		JSON.stringify({
			oponeoReservationId: '2900000',
			...synced,
			lastSeen: '2026-11-02T07:00:00.000Z',
		}),
});

describe('syncer: WO => OPONEO workflow', () => {
	describe('Prepare data for Oponeo2', () => {
		beforeEach(() => {
			jest.spyOn(console, 'log').mockImplementation(() => undefined);
		});

		it('sends only events that are new or moved since they were synced', () => {
			const result = runCode('Prepare data for Oponeo2', {
				withinHoursReservations: [
					woEvent(1, '2026-11-09T14:00:00+01:00', '2026-11-09T15:00:00+01:00'),
					woEvent(2, '2026-11-09T16:00:00+01:00', '2026-11-09T17:00:00+01:00', {
						startTime: '2026-11-09T16:00:00.000Z',
						endTime: '2026-11-09T17:00:00.000Z',
					}),
					woEvent(3, '2026-11-10T09:00:00+01:00', '2026-11-10T10:00:00+01:00', {
						startTime: '2026-11-09T09:00:00.000Z',
						endTime: '2026-11-09T10:00:00.000Z',
					}),
				],
			});

			const reservations = result[0]?.json['reservations'] as {
				woReservationId: number;
			}[];
			expect(reservations.map((r) => r.woReservationId)).toEqual([1, 3]);
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
