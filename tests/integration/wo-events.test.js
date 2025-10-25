const request = require('supertest');
const express = require('express');

// Mock utils before requiring the route
jest.mock('../../utils', () => ({
	logger: {
		info: jest.fn(),
		error: jest.fn(),
	},
	getCurrentDate: jest.fn(() => '2025-01-15'),
	getCurrentDateMidnight: jest.fn(() => '2025-01-15T00:00:00.000Z'),
}));

const woEventsRouter = require('../../routes/wo-events');

describe('WO Events Routes', () => {
	let app;
	const originalEnv = process.env;

	beforeEach(() => {
		// Create a fresh Express app for each test
		app = express();
		app.use(express.json());
		app.use('/wo', woEventsRouter);

		// Reset environment
		process.env = { ...originalEnv };

		// Clear all mocks
		jest.clearAllMocks();
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe('GET /wo/events', () => {
		it('should return 500 when WO_API_KEY is not configured', async () => {
			delete process.env.WO_API_KEY;

			const response = await request(app)
				.get('/wo/events')
				.expect(500);

			expect(response.body).toMatchObject({
				success: false,
				error: 'API configuration error',
				details: 'WO_API_KEY is not configured',
			});
		});

		it('should fetch events successfully with default parameters', async () => {
			process.env.WO_API_KEY = 'test-api-key';

			const mockEventsData = [
				{
					id: 1,
					startDate: '2025-01-15T10:00:00',
					endDate: '2025-01-15T11:00:00',
					licencePlate: 'ABC123',
				},
				{
					id: 2,
					startDate: '2025-01-15T14:00:00',
					endDate: '2025-01-15T15:00:00',
					licencePlate: 'XYZ789',
				},
			];

			// Mock global fetch
			global.fetch = jest.fn(() =>
				Promise.resolve({
					ok: true,
					json: async () => mockEventsData,
				})
			);

		const response = await request(app)
			.get('/wo/events')
			.expect(200);

	expect(response.body.success).toBe(true);
	expect(response.body.data).toEqual(mockEventsData);

	// Check metadata
	expect(response.body.metadata.source).toBe('WO API');
	expect(response.body.metadata.parameters.page).toBe(1);
	expect(response.body.metadata.parameters.itemsPerPage).toBe(100);

	// Verify fetch was called with correct URL and headers
		expect(global.fetch).toHaveBeenCalledWith(
			expect.stringContaining('https://api.wymianaopon.pl/api/events/planned'),
			expect.objectContaining({
				method: 'GET',
				headers: {
					'accept': '*/*',
					'Authorization': 'Bearer test-api-key',
				},
			})
		);

	// Verify URL parameters
	const fetchUrl = global.fetch.mock.calls[0][0];
	expect(fetchUrl).toContain('page=1');
	expect(fetchUrl).toContain('itemsPerPage=100');
	expect(fetchUrl).toContain('updated_at_from=');
});

		it('should use custom pagination parameters', async () => {
			process.env.WO_API_KEY = 'test-api-key';

			global.fetch = jest.fn(() =>
				Promise.resolve({
					ok: true,
					json: async () => [],
				})
			);

			await request(app)
				.get('/wo/events?page=3&itemsPerPage=50')
				.expect(200);

			const fetchUrl = global.fetch.mock.calls[0][0];
			expect(fetchUrl).toContain('page=3');
			expect(fetchUrl).toContain('itemsPerPage=50');
		});

		it('should handle WO API errors', async () => {
			process.env.WO_API_KEY = 'test-api-key';

			global.fetch = jest.fn(() =>
				Promise.resolve({
					ok: false,
					status: 401,
					text: async () => 'Unauthorized',
				})
			);

			const response = await request(app)
				.get('/wo/events')
				.expect(401);

			expect(response.body).toMatchObject({
				success: false,
				error: 'WO API request failed with status 401',
				details: 'Unauthorized',
			});
		});

		it('should handle network errors', async () => {
			process.env.WO_API_KEY = 'test-api-key';

			global.fetch = jest.fn(() =>
				Promise.reject(new Error('Network error'))
			);

			const response = await request(app)
				.get('/wo/events')
				.expect(500);

			expect(response.body).toMatchObject({
				success: false,
				error: 'Network error',
				details: 'An error occurred while fetching work order events',
			});
		});

		it('should handle empty response from WO API', async () => {
			process.env.WO_API_KEY = 'test-api-key';

			global.fetch = jest.fn(() =>
				Promise.resolve({
					ok: true,
					json: async () => [],
				})
			);

			const response = await request(app)
				.get('/wo/events')
				.expect(200);

			expect(response.body.success).toBe(true);
			expect(response.body.data).toEqual([]);
		});

		it('should include timestamp in response metadata', async () => {
			process.env.WO_API_KEY = 'test-api-key';

			global.fetch = jest.fn(() =>
				Promise.resolve({
					ok: true,
					json: async () => [],
				})
			);

			const beforeTime = new Date();
			const response = await request(app)
				.get('/wo/events')
				.expect(200);
			const afterTime = new Date();

			const responseTimestamp = new Date(response.body.metadata.timestamp);
			expect(responseTimestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
			expect(responseTimestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime());
		});
	});
});
