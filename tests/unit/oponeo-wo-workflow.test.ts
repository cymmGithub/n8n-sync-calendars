import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface WorkflowNode {
	name: string;
	retryOnFail?: boolean;
	parameters: {
		rules?: {
			values: { conditions: { conditions: { leftValue: string }[] } }[];
		};
		jsCode?: string;
		key?: string;
		operation?: string;
		expire?: boolean;
		ttl?: number;
	};
}

type Connections = Record<
	string,
	{ main: ({ node: string; index: number }[] | null)[] }
>;

const workflow = JSON.parse(
	readFileSync(
		join(__dirname, '../../workflows/syncer_ OPONEO =_ WO.json'),
		'utf8',
	),
) as { nodes: WorkflowNode[]; connections: Connections };

const node = (name: string): WorkflowNode => {
	const found = workflow.nodes.find((n) => n.name === name);
	if (!found) throw new Error(`Node "${name}" not found`);
	return found;
};

// Evaluates an n8n `={{ ... }}` expression against a given $json.
// A throwing condition counts as not matching, like in n8n (rules 0 and 1
// dereference a null reservation for items not yet stored in Redis).
const evaluate = (expression: string, $json: Record<string, unknown>) => {
	const body = expression.replace(/^=\{\{/, '').replace(/\}\}$/, '');
	try {
		// eslint-disable-next-line @typescript-eslint/no-implied-eval -- running the workflow's own expression is the point
		return new Function('$json', `return (${body});`)($json) as boolean;
	} catch {
		return false;
	}
};

// Returns indexes of Notification Determinator outputs matching $json
const matchingOutputs = ($json: Record<string, unknown>): number[] =>
	(node('Notification Determinator').parameters.rules?.values ?? [])
		.map((rule, index) =>
			rule.conditions.conditions.every((c) => evaluate(c.leftValue, $json))
				? index
				: -1,
		)
		.filter((index) => index !== -1);

// Shape of the error item produced by the HTTP node with continueRegularOutput
const slotTakenError = {
	message:
		'400 - "{\\"error\\":{\\"fromDate\\":\\"Stanowisko jest niedost\\\\u0119pne w wybranym terminie\\"}}"',
	name: 'AxiosError',
	code: 'ERR_BAD_REQUEST',
	status: 400,
};

const NEW_CONFLICT = 2;
const NO_CONFLICT = 3;
const SYNC_FAILED = 4;

// Names of nodes wired to the given output of a node
const targets = (from: string, output = 0): string[] =>
	(workflow.connections[from]?.main[output] ?? []).map((c) => c.node);

// Runs a Code node's jsCode with the given input items
const runCode = (name: string, items: Record<string, unknown>[]) => {
	const $input = { all: () => items.map((json) => ({ json })) };
	// eslint-disable-next-line @typescript-eslint/no-implied-eval -- running the workflow's own code is the point
	return new Function('$input', node(name).parameters.jsCode ?? '')($input) as {
		json: Record<string, unknown>;
	}[];
};

const failedItem = (reservationId: string, count: number) => ({
	reservationId,
	[`OPONEO_FAIL:${reservationId}`]: count,
	firstname: 'Jan',
	lastname: 'Kowalski',
	fromDate: '2026-10-09T16:00:00.000Z',
	toDate: '2026-10-09T17:00:00.000Z',
	notes: {
		oponeo_url: `https://autoserwis.oponeo.pl/rezerwacja/${reservationId}`,
	},
	error: { message: '502 - Bad Gateway', status: 502 },
});

describe('syncer: OPONEO => WO workflow', () => {
	it('does not retry the non-idempotent POST to WO', () => {
		// n8n retries the whole node with all items when the first item errors,
		// which re-POSTs already created reservations and fakes a conflict
		expect(node('POST to WO calendar1').retryOnFail).not.toBe(true);
	});

	describe('Notification Determinator', () => {
		it('routes a taken WO slot to the new conflict output', () => {
			expect(
				matchingOutputs({ reservation: null, error: slotTakenError }),
			).toEqual([NEW_CONFLICT]);
		});

		it('routes a successful POST to the no conflict output', () => {
			expect(matchingOutputs({ reservation: null })).toEqual([NO_CONFLICT]);
		});

		it.each([
			['server error', { message: '502 - Bad Gateway', status: 502 }],
			[
				'timeout',
				{ message: 'timeout of 300000ms exceeded', code: 'ECONNABORTED' },
			],
			[
				'other validation error',
				{ message: '400 - "{\\"error\\":{\\"phone\\":\\"x\\"}}"', status: 400 },
			],
		])('routes a %s to the sync failed output', (_, error) => {
			expect(matchingOutputs({ reservation: null, error })).toEqual([
				SYNC_FAILED,
			]);
		});
	});

	describe('sync failure alert', () => {
		it('counts failures per reservation with a 7 day TTL', () => {
			expect(targets('Notification Determinator', SYNC_FAILED)).toEqual(
				expect.arrayContaining(['Count sync failure']),
			);
			expect(node('Count sync failure').parameters).toMatchObject({
				operation: 'incr',
				key: '=OPONEO_FAIL:{{ $json.reservationId }}',
				expire: true,
				ttl: 7 * 24 * 60 * 60,
			});
		});

		it('clears the failure count once a reservation syncs or conflicts', () => {
			expect(targets('Notification Determinator', NEW_CONFLICT)).toContain(
				'Clear sync failure count',
			);
			expect(targets('Notification Determinator', NO_CONFLICT)).toContain(
				'Clear sync failure count',
			);
			expect(node('Clear sync failure count').parameters).toMatchObject({
				operation: 'delete',
				key: '=OPONEO_FAIL:{{ $json.reservationId }}',
			});
		});

		it('sends Slack and email alerts from the threshold node', () => {
			expect(targets('Sync failure threshold')).toEqual(
				expect.arrayContaining(['Sync failed alert', 'Sync failed mail']),
			);
		});

		it('alerts once, on the third consecutive failure, in one message', () => {
			const result = runCode('Sync failure threshold', [
				failedItem('1', 2),
				failedItem('2', 3),
				failedItem('3', 3),
				failedItem('4', 4),
			]);

			expect(result).toHaveLength(1);
			expect(result[0]?.json['reservations']).toEqual([
				expect.objectContaining({
					reservationId: '2',
					from: '09.10.2026 16:00',
				}),
				expect.objectContaining({
					reservationId: '3',
					error: '502 - Bad Gateway',
				}),
			]);
		});

		it('stays silent when no reservation reached the threshold', () => {
			expect(
				runCode('Sync failure threshold', [
					failedItem('1', 1),
					failedItem('2', 4),
				]),
			).toEqual([]);
		});
	});
});
