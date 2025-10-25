const express = require('express');
const { logger, getCurrentDateMidnight } = require('../utils');

const router = express.Router();

// GET /wo-events - Fetch work order events from WO API
router.get('/events', async (req, res) => {
	try {
		logger.info('Work order events endpoint called');

		// Extract query parameters or use defaults
		const page = req.query.page || 1;
		const itemsPerPage = req.query.itemsPerPage || 100;
		const updated_at_from = getCurrentDateMidnight();

		// Validate WO_API_KEY exists
		if (!process.env.WO_API_KEY) {
			logger.error('WO_API_KEY environment variable is not set');
			return res.status(500).json({
				success: false,
				error: 'API configuration error',
				details: 'WO_API_KEY is not configured',
			});
		}

		// Build WO API URL with query parameters
		const woApiUrl = new URL('https://api.wymianaopon.pl/api/events/planned');
		woApiUrl.searchParams.set('page', page);
		woApiUrl.searchParams.set('itemsPerPage', itemsPerPage);
		woApiUrl.searchParams.set('updated_at_from', updated_at_from);

		logger.info(`Fetching WO events from: ${woApiUrl.toString()}`);

		// Make request to WO API
		const response = await fetch(woApiUrl.toString(), {
			method: 'GET',
			headers: {
				'accept': '*/*',
				'Authorization': `Bearer ${process.env.WO_API_KEY}`,
			},
		});

		if (!response.ok) {
			logger.error(`WO API request failed with status: ${response.status}`);
			const errorText = await response.text();
			logger.error(`WO API error response: ${errorText}`);

			return res.status(response.status).json({
				success: false,
				error: `WO API request failed with status ${response.status}`,
				details: errorText,
			});
		}

		const woData = await response.json();
		logger.info(`Successfully fetched ${woData?.length || 'unknown'} events from WO API`);

		res.json({
			success: true,
			data: woData,
			metadata: {
				source: 'WO API',
				timestamp: new Date().toISOString(),
				parameters: {
					page: parseInt(page),
					itemsPerPage: parseInt(itemsPerPage),
					updated_at_from,
				},
			},
		});

	} catch (error) {
		logger.error('Error in work order events endpoint', {
			error: error.message,
			stack: error.stack,
		});

		res.status(500).json({
			success: false,
			error: error.message,
			details: 'An error occurred while fetching work order events',
		});
	}
});

module.exports = router;
