import request from 'supertest';
import express from 'express';
import type { Browser } from 'playwright';

jest.mock('../../src/utils/logger.js', () => ({
	logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Each launched browser stands for a new proxy (the proxy is picked at launch)
jest.mock('../../src/utils/browser.js', () => ({
	createBrowserInstance: jest.fn(),
	createBrowserContext: jest.fn(),
	randomDelay: jest.fn(),
}));

jest.mock('../../src/scrapers/oponeo.js', () => ({
	authenticateOponeo: jest.fn(),
	getAllPagesReservations: jest.fn(),
	scrapeReservationDetails: jest.fn(),
}));

import {
	createBrowserInstance,
	createBrowserContext,
} from '../../src/utils/browser.js';
import { authenticateOponeo } from '../../src/scrapers/oponeo.js';
import { browserPool } from '../../src/services/browser-pool.js';
import scraperRoutes from '../../src/routes/oponeo-scraper.js';

const app = express();
app.use(express.json());
app.use('/oponeo', scraperRoutes);

const proxyTimeout = new Error(
	'page.goto: net::ERR_TIMED_OUT at https://autoserwis.oponeo.pl/logowanie',
);

describe('Oponeo routes', () => {
	beforeEach(async () => {
		process.env['OPONEO_EMAIL'] = 'test-przemka@example.com';
		process.env['OPONEO_PASSWORD'] = 'test-przemka';
		await browserPool.closeBrowser();

		const page = {};
		const context = { close: jest.fn() };
		(createBrowserInstance as jest.Mock).mockImplementation(
			async () => ({ close: jest.fn() }) as unknown as Browser,
		);
		(createBrowserContext as jest.Mock).mockResolvedValue({ context, page });
	});

	afterAll(async () => {
		await browserPool.closeBrowser();
	});

	it.each([
		['/oponeo/mutator', { reservations: [{ startDate: 1, endDate: 2 }] }],
		['/oponeo/obliterator', { oponeoReservationIds: ['2900001'] }],
		['/oponeo/scraper', {}],
	])(
		'%s retries a failed login through a new browser, so a new proxy',
		async (path, body) => {
			(authenticateOponeo as jest.Mock).mockRejectedValue(proxyTimeout);

			// n8n retries the same request when the first one fails
			await request(app).post(path).send(body).expect(500);
			await request(app).post(path).send(body).expect(500);

			expect(createBrowserInstance).toHaveBeenCalledTimes(2);
		},
	);
});
