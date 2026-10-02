import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface WorkflowNode {
	name: string;
	retryOnFail?: boolean;
	parameters: {
		rules?: {
			values: { conditions: { conditions: { leftValue: string }[] } }[];
		};
	};
}

const workflow = JSON.parse(
	readFileSync(
		join(__dirname, '../../workflows/syncer_ OPONEO =_ WO.json'),
		'utf8',
	),
) as { nodes: WorkflowNode[] };

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
		])('ignores a %s so the next run retries it', (_, error) => {
			expect(matchingOutputs({ reservation: null, error })).toEqual([]);
		});
	});
});
