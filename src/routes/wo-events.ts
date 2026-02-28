import { Router } from 'express';
import type { Request, Response } from 'express';
import { getCurrentDate, getCurrentDateMidnight } from '../utils/dates.js';
import { logger } from '../utils/logger.js';

const router = Router();

// GET /wo-events - Fetch work order events from WO API
router.get('/events', async (req: Request, res: Response): Promise<void> => {
	try {
		logger.info('Work order events endpoint called');

		// Extract query parameters or use defaults
		const page = (req.query['page'] as string) ?? '1';
		const itemsPerPage =
			(req.query['itemsPerPage'] as string) ?? '100';

		// Determine which date parameter to use based on 'filter_by' query parameter
		let dateFrom: string | undefined;
		let updatedAtFrom: string | undefined;

		if (req.query['filter_by'] === 'date_from') {
			dateFrom = getCurrentDate();
		}

		if (req.query['filter_by'] === 'updated_at_from') {
			updatedAtFrom = getCurrentDateMidnight();
		}

		// Validate WO_API_KEY exists
		if (!process.env['WO_API_KEY']) {
			logger.error('WO_API_KEY environment variable is not set');
			res.status(500).json({
				success: false,
				error: 'API configuration error',
				details: 'WO_API_KEY is not configured',
			});
			return;
		}

		// Build WO API URL with query parameters
		const woApiUrl = new URL(
			'https://api.wymianaopon.pl/api/events/planned',
		);
		woApiUrl.searchParams.set('page', page);
		woApiUrl.searchParams.set('itemsPerPage', itemsPerPage);

		// Add date filters based on what was determined
		if (dateFrom) {
			woApiUrl.searchParams.set('date_from', dateFrom);
		}
		if (updatedAtFrom) {
			woApiUrl.searchParams.set('updated_at_from', updatedAtFrom);
		}

		logger.info(`Fetching WO events from: ${woApiUrl.toString()}`);

		// Make request to WO API
		const response = await fetch(woApiUrl.toString(), {
			method: 'GET',
			headers: {
				accept: '*/*',
				Authorization: `Bearer ${process.env['WO_API_KEY']}`,
			},
		});

		if (!response.ok) {
			logger.error(
				`WO API request failed with status: ${response.status.toString()}`,
			);
			const errorText = await response.text();
			logger.error(`WO API error response: ${errorText}`);

			res.status(response.status).json({
				success: false,
				error: `WO API request failed with status ${response.status.toString()}`,
				details: errorText,
			});
			return;
		}

		const woData: unknown = await response.json();
		logger.info(
			`Successfully fetched ${Array.isArray(woData) ? woData.length.toString() : 'unknown'} events from WO API`,
		);

		res.json({
			success: true,
			data: woData,
			metadata: {
				source: 'WO API',
				timestamp: new Date().toISOString(),
				parameters: {
					page: parseInt(page),
					itemsPerPage: parseInt(itemsPerPage),
					...(dateFrom && { date_from: dateFrom }),
					...(updatedAtFrom && {
						updated_at_from: updatedAtFrom,
					}),
				},
			},
		});
	} catch (error) {
		logger.error('Error in work order events endpoint', {
			error:
				error instanceof Error ? error.message : 'Unknown error',
			stack: error instanceof Error ? error.stack : undefined,
		});

		res.status(500).json({
			success: false,
			error:
				error instanceof Error ? error.message : 'Unknown error',
			details:
				'An error occurred while fetching work order events',
		});
	}
});

export default router;
