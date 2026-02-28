import request from 'supertest';
import express from 'express';

// Mock the NEW module paths before requiring the route
jest.mock('../../src/utils/logger.js', () => ({
	logger: {
		info: jest.fn(),
		error: jest.fn(),
	},
}));
jest.mock('../../src/utils/dates.js', () => ({
	getCurrentDate: jest.fn(() => '2025-01-15'),
	getCurrentDateMidnight: jest.fn(() => '2025-01-15T00:00:00.000Z'),
}));

describe('WO Events Routes', () => {
	let app: express.Express;
	let woEventsRouter: express.Router;
	const originalEnv = process.env;

	beforeEach(() => {
		// Clear module cache and reload the router to ensure latest changes
		jest.resetModules();
		woEventsRouter = require('../../src/routes/wo-events.js').default;

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

			const response = await request(app).get('/wo/events').expect(500);

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
			global.fetch = jest.fn().mockResolvedValue({
				ok: true,
				json: async () => mockEventsData,
			}) as jest.Mock;

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
				expect.stringContaining(
					'https://api.wymianaopon.pl/api/events/planned',
				),
				expect.objectContaining({
					method: 'GET',
					headers: {
						accept: '*/*',
						Authorization: 'Bearer test-api-key',
					},
				}),
			);

			// Verify URL parameters
			const fetchUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
			expect(fetchUrl).toContain('page=1');
			expect(fetchUrl).toContain('itemsPerPage=100');
			// Without begin parameter, no date filters should be added
			expect(fetchUrl).not.toContain('updated_at_from');
			expect(fetchUrl).not.toContain('date_from');
		});

		it('should use custom pagination parameters', async () => {
			process.env.WO_API_KEY = 'test-api-key';

			global.fetch = jest.fn().mockResolvedValue({
				ok: true,
				json: async () => [],
			}) as jest.Mock;

			await request(app)
				.get('/wo/events?page=3&itemsPerPage=50')
				.expect(200);

			const fetchUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
			expect(fetchUrl).toContain('page=3');
			expect(fetchUrl).toContain('itemsPerPage=50');
		});

		it('should handle WO API errors', async () => {
			process.env.WO_API_KEY = 'test-api-key';

			global.fetch = jest.fn().mockResolvedValue({
				ok: false,
				status: 401,
				text: async () => 'Unauthorized',
			}) as jest.Mock;

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

			global.fetch = jest
				.fn()
				.mockRejectedValue(new Error('Network error')) as jest.Mock;

			const response = await request(app)
				.get('/wo/events')
				.expect(500);

			expect(response.body).toMatchObject({
				success: false,
				error: 'Network error',
				details:
					'An error occurred while fetching work order events',
			});
		});

		it('should handle empty response from WO API', async () => {
			process.env.WO_API_KEY = 'test-api-key';

			global.fetch = jest.fn().mockResolvedValue({
				ok: true,
				json: async () => [],
			}) as jest.Mock;

			const response = await request(app)
				.get('/wo/events')
				.expect(200);

			expect(response.body.success).toBe(true);
			expect(response.body.data).toEqual([]);
		});

		it('should include timestamp in response metadata', async () => {
			process.env.WO_API_KEY = 'test-api-key';

			global.fetch = jest.fn().mockResolvedValue({
				ok: true,
				json: async () => [],
			}) as jest.Mock;

			const beforeTime = new Date();
			const response = await request(app)
				.get('/wo/events')
				.expect(200);
			const afterTime = new Date();

			const responseTimestamp = new Date(
				response.body.metadata.timestamp,
			);
			expect(responseTimestamp.getTime()).toBeGreaterThanOrEqual(
				beforeTime.getTime(),
			);
			expect(responseTimestamp.getTime()).toBeLessThanOrEqual(
				afterTime.getTime(),
			);
		});

		it('should set date_from when filter_by=date_from', async () => {
			process.env.WO_API_KEY = 'test-api-key';

			global.fetch = jest.fn().mockResolvedValue({
				ok: true,
				json: async () => [],
			}) as jest.Mock;

			const response = await request(app)
				.get('/wo/events?filter_by=date_from')
				.expect(200);

			// Verify metadata includes date_from
			expect(response.body.metadata.parameters.date_from).toBe(
				'2025-01-15',
			);
			expect(
				response.body.metadata.parameters.updated_at_from,
			).toBeUndefined();

			// Verify URL includes date_from parameter
			const fetchUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
			expect(fetchUrl).toContain('date_from=2025-01-15');
			expect(fetchUrl).not.toContain('updated_at_from');
		});

		it('should set updated_at_from when filter_by=updated_at_from', async () => {
			process.env.WO_API_KEY = 'test-api-key';

			global.fetch = jest.fn().mockResolvedValue({
				ok: true,
				json: async () => [],
			}) as jest.Mock;

			const response = await request(app)
				.get('/wo/events?filter_by=updated_at_from')
				.expect(200);

			// Verify metadata includes updated_at_from
			expect(
				response.body.metadata.parameters.updated_at_from,
			).toBe('2025-01-15T00:00:00.000Z');
			expect(
				response.body.metadata.parameters.date_from,
			).toBeUndefined();

			// Verify URL includes updated_at_from parameter
			const fetchUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
			expect(fetchUrl).toContain(
				'updated_at_from=2025-01-15T00%3A00%3A00.000Z',
			);
			expect(fetchUrl).not.toContain('date_from');
		});

		it('should not set any date filters when filter_by parameter is missing', async () => {
			process.env.WO_API_KEY = 'test-api-key';

			global.fetch = jest.fn().mockResolvedValue({
				ok: true,
				json: async () => [],
			}) as jest.Mock;

			const response = await request(app)
				.get('/wo/events')
				.expect(200);

			// Verify metadata does not include date filters
			expect(
				response.body.metadata.parameters.date_from,
			).toBeUndefined();
			expect(
				response.body.metadata.parameters.updated_at_from,
			).toBeUndefined();

			// Verify URL does not include date filter parameters
			const fetchUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
			expect(fetchUrl).not.toContain('date_from');
			expect(fetchUrl).not.toContain('updated_at_from');
		});

		it('should not set any date filters when filter_by parameter has invalid value', async () => {
			process.env.WO_API_KEY = 'test-api-key';

			global.fetch = jest.fn().mockResolvedValue({
				ok: true,
				json: async () => [],
			}) as jest.Mock;

			const response = await request(app)
				.get('/wo/events?filter_by=invalid_value')
				.expect(200);

			// Verify metadata does not include date filters
			expect(
				response.body.metadata.parameters.date_from,
			).toBeUndefined();
			expect(
				response.body.metadata.parameters.updated_at_from,
			).toBeUndefined();

			// Verify URL does not include date filter parameters
			const fetchUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
			expect(fetchUrl).not.toContain('date_from');
			expect(fetchUrl).not.toContain('updated_at_from');
		});

		it('should combine filter_by parameter with pagination parameters', async () => {
			process.env.WO_API_KEY = 'test-api-key';

			global.fetch = jest.fn().mockResolvedValue({
				ok: true,
				json: async () => [],
			}) as jest.Mock;

			const response = await request(app)
				.get('/wo/events?page=2&itemsPerPage=50&filter_by=date_from')
				.expect(200);

			// Verify all parameters in metadata
			expect(response.body.metadata.parameters.page).toBe(2);
			expect(response.body.metadata.parameters.itemsPerPage).toBe(50);
			expect(response.body.metadata.parameters.date_from).toBe(
				'2025-01-15',
			);

			// Verify URL includes all parameters
			const fetchUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
			expect(fetchUrl).toContain('page=2');
			expect(fetchUrl).toContain('itemsPerPage=50');
			expect(fetchUrl).toContain('date_from=2025-01-15');
		});
	});
});
