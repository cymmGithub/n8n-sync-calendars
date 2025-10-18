const express = require('express');
const {
	logger,
	authenticate_oponeo,
	get_all_pages_reservations,
	scrape_reservation_details,
	get_reservations_from_now_url,
	convertTicksToDate,
	formatTime,
	browserPool,
	createBrowserContext,
	randomDelay,
} = require('../utils');

const router = express.Router();

router.post('/scraper', async (req, res) => {
	const url = process.env.OPONEO_BASE_URL;
	const { debug_mode = false } = req.body;
	const email = process.env.OPONEO_EMAIL;
	const password = process.env.OPONEO_PASSWORD;

	if (!email || !password) {
		return res.status(400).send('Email and password are required');
	}

	let browser;
	let context;
	try {
		// Use browser pool
		browser = await browserPool.getBrowser(debug_mode);
		const { context: ctx, page } = await createBrowserContext(browser, debug_mode);
		context = ctx;

		await authenticate_oponeo(page, email, password);

		const reservations_from_now_url = get_reservations_from_now_url();

		logger.info(
			`Accessing reservations with URL: ${reservations_from_now_url}`
		);
		await page.goto(reservations_from_now_url, { waitUntil: 'load' });

		const reservations_data = await get_all_pages_reservations(page);
		logger.info(
			`Found ${reservations_data.reservations.length} reservations across all pages`
		);

		const detailed_reservations = [];
		let processed = 0;
		let skipped = 0;

		for (const reservation of reservations_data.reservations) {
			if (reservation.reservation_url) {
				processed++;
				logger.info(
					`Processing reservation ${processed}/${reservations_data.reservations.length}: ${reservation.reservation_number}`
				);

				const details = await scrape_reservation_details(
					page,
					reservation.reservation_url,
					debug_mode
				);

				// only add reservations that returned details (those with "Rezerwacja oponeo")
				if (details) {
					detailed_reservations.push({
						...reservation,
						details,
					});
					logger.info(
						`Added reservation ${reservation.reservation_number} to results`
					);
				} else {
					skipped++;
					logger.info(
						`Skipped reservation ${reservation.reservation_number} - not an Oponeo reservation`
					);
				}
			}
		}

	logger.info(
		`Reservation processing complete: Total processed: ${processed}, Included: ${detailed_reservations.length}, Skipped: ${skipped}`
	);

	// Close context and release browser back to pool
	if (context) {
		await context.close();
	}
	await browserPool.releaseBrowser();

	const final_stats = {
		pagination: reservations_data.stats,
		processing: {
			total_processed: processed,
			included: detailed_reservations.length,
			skipped: skipped,
		},
	};

	logger.info('Successfully scraped data after authentication', {
		url: url || 'https://autoserwis.oponeo.pl/',
		data_keys: Object.keys(detailed_reservations),
		stats: final_stats,
	});

	res.json({
		success: true,
		data: detailed_reservations,
		stats: final_stats,
	});
} catch (error) {
	logger.error('Error during scraping process', {
		error: error.message,
		stack: error.stack,
	});

	// Cleanup on error
	if (context) {
		try {
			await context.close();
		} catch (e) {
			logger.error('Error closing context:', e.message);
		}
	}
	if (browser) {
		await browserPool.releaseBrowser();
	}

	res.status(500).json({
		success: false,
		error: error.message,
		details: 'An error occurred during the scraping process',
	});
}
});

router.post('/mutator', async (req, res) => {
	const { debug_mode = false, reservations = [] } = req.body;
	const email = process.env.OPONEO_EMAIL;
	const password = process.env.OPONEO_PASSWORD;

	if (!email || !password) {
		return res.status(400).send('Email and password are required');
	}

	// Handle empty array case - this is totally fine
	if (reservations.length === 0) {
		logger.info('No reservations to process - empty array provided');
		return res.json({
			success: true,
			results: [],
			errors: [],
			metadata: {
				timestamp: new Date().toISOString(),
				processed: 0,
				message: 'No reservations to process',
			},
		});
	}

	let browser;
	let context;
	const results = [];
	const errors = [];

	try {
		// Use browser pool
		browser = await browserPool.getBrowser(debug_mode);
		const { context: ctx, page } = await createBrowserContext(browser, debug_mode);
		context = ctx;

		// Authenticate once
		await authenticate_oponeo(page, email, password);
		logger.info('Authentication successful, starting reservation mutations');

		// Process each reservation
		for (let i = 0; i < reservations.length; i++) {
			const reservation = reservations[i];
			logger.info(
				`Processing reservation ${i + 1}/${reservations.length}:`,
				reservation
			);
			let reservationId;

			// Convert .NET ticks to dates
			const startDate = convertTicksToDate(reservation.startDate);
			const endDate = convertTicksToDate(reservation.endDate);

			// Format for URL (YYYY-MM-DD format but we need ticks for the URL)
			const startDateTicks = reservation.startDate;
			const endDateHour = formatTime(endDate); // e.g., "14:20"

			const licencePlate = reservation.licencePlate || 'WO';
			const phoneNumber = reservation.phoneNumber || 'WO';


			try {
				logger.info(
					`Creating reservation for ${licencePlate} at ${startDate.toISOString()} - ${endDate.toISOString()}`
				);

				// Navigate to new reservation page with start date
				const reservationUrl = `https://autoserwis.oponeo.pl/nowa-rezerwacja?data-od=${startDateTicks}&stanowisko=3166`;
				await page.goto(reservationUrl, { waitUntil: 'load' });

				// Set end time
				logger.info(`Setting end time to: ${endDateHour}`);
				await randomDelay(200, 500);
				await page.locator('input[name="DateChoose\\.TimeTo"]').click();

				const timeSlotLocator = page
					.locator('div.hours > div')
					.filter({ hasText: new RegExp(`^${endDateHour}$`) })
					.nth(endDateHour === '17:00' ? 0 : 1);

				const isDisabled = (
					await timeSlotLocator.getAttribute('class', { timeout: 10000 })
				)?.includes('disabled');

				if (isDisabled) {
					throw new Error(
						`HOUR_CONFLICT - Time slot ${endDateHour} is disabled.`
					);
				}

				try {
					await randomDelay(100, 300);
					await timeSlotLocator.click({ timeout: 1000 });
				} catch (error) {
					logger.error(`Failed to click time slot ${endDateHour}`, { error });
					throw new Error(
						`CLICK_FAILED - Could not click time slot ${endDateHour}. It might be obscured or not interactive.`
					);
				}

				// Fill vehicle registration number
				await randomDelay(150, 400);
				await page.locator('input[name="VehicleRegistrationNumber"]').click();
				await randomDelay(50, 150);
				await page
					.locator('input[name="VehicleRegistrationNumber"]')
					.fill(licencePlate);

				// Fill client first name (using phone number as requested)
				await randomDelay(200, 500);
				await page.locator('input[name="ClientFirstName"]').click();
				await randomDelay(50, 150);
				await page.locator('input[name="ClientFirstName"]').fill(phoneNumber);

				// Submit the reservation
				await randomDelay(300, 600);
				await page
					.locator('a')
					.filter({ hasText: /^Dodaj rezerwację$/ })
					.click();

				// Wait for success message
				try {
					await page.waitForSelector('text=Pomyślnie dodano rezerwację', {
						timeout: 5000,
					});
					logger.info(`Successfully created reservation for ${licencePlate}`);

					// Click the button to go to the reservation page
					await page.getByText('Wróć do rezerwacji').click();

					// Wait for navigation and extract numeric ID from URL
					await page.waitForURL(/\/rezerwacja\/\d+/, { timeout: 10000 });
					const currentUrl = page.url();
					reservationId = currentUrl.split('/').pop();

					results.push({
						index: i,
						success: true,
						reservation,
						reservationId,
						message: 'Reservation created successfully',
						licencePlate,
						phoneNumber,
						startTime: startDate.toISOString(),
						endTime: endDate.toISOString(),
					});
				} catch (successError) {
					throw new Error(
						'CREATION_FAILED - Success message not found or reservation ID could not be extracted.'
					);
				}
			} catch (reservationError) {
				logger.error(
					`Failed to create reservation ${i + 1}:`,
					reservationError.message
				);

				errors.push({
					index: i,
					reservation,
					reservationId,
					message: 'Reservation created successfully',
					licencePlate,
					phoneNumber,
					startTime: startDate.toISOString(),
					endTime: endDate.toISOString(),
					error: reservationError.message,
					timestamp: new Date().toISOString(),
				});

				// Continue with next reservation
				continue;
		}
	}

	// Close context and release browser back to pool
	if (context) {
		await context.close();
	}
	await browserPool.releaseBrowser();

	const summary = {
		total: reservations.length,
		successful: results.length,
		failed: errors.length,
		success_rate:
			((results.length / reservations.length) * 100).toFixed(2) + '%',
	};

	logger.info('Mutation process complete:', summary);

	res.json({
		success: true,
		summary: summary,
		results: results,
		errors: errors,
		metadata: {
			timestamp: new Date().toISOString(),
			processed: reservations.length,
			authentication: 'successful',
		},
	});
} catch (error) {
	logger.error('Error during mutation process', {
		error: error.message,
		stack: error.stack,
	});

	// Cleanup on error
	if (context) {
		try {
			await context.close();
		} catch (e) {
			logger.error('Error closing context:', e.message);
		}
	}
	if (browser) {
		await browserPool.releaseBrowser();
	}

	res.status(500).json({
		success: false,
		error: error.message,
		details: 'An error occurred during the mutation process',
		partial_results: results,
		errors: errors,
	});
}
});

router.post('/obliterator', async (req, res) => {
	const { debug_mode = false, oponeoReservationId = null } = req.body;
	const email = process.env.OPONEO_EMAIL;
	const password = process.env.OPONEO_PASSWORD;

	if (!email || !password) {
		return res.status(400).send('Email and password are required');
	}

	let browser;
	let context;
	const results = [];
	const errors = [];

	try {
		// Use browser pool
		browser = await browserPool.getBrowser(debug_mode);
		const { context: ctx, page } = await createBrowserContext(browser, debug_mode);
		context = ctx;

		// Authenticate once
		await authenticate_oponeo(page, email, password);
		logger.info('Authentication successful, starting reservation obliteration');

		try {
			if (!oponeoReservationId) {
				throw new Error('MISSING_ID - oponeoReservationId is required');
			}

			// Navigate to the reservation edit page
			const editUrl = `https://autoserwis.oponeo.pl/edycja-rezerwacji/${oponeoReservationId}`;
			logger.info(`Navigating to: ${editUrl}`);

			await page.goto(editUrl, { waitUntil: 'load' });

			// Wait a moment for the page to fully load
			await page.waitForTimeout(1000);

			await page.getByRole('link', { name: 'Usuń rezerwację' }).click();
			await page.getByText('Usuń', { exact: true }).click();

			await page.waitForTimeout(3000);

			results.push({
				success: true,
				message: `Successfully obliterated ${oponeoReservationId}`,
				timestamp: new Date().toISOString(),
			});
		} catch (reservationError) {
			logger.error(
				`Failed to process reservation ${oponeoReservationId}:`,
				reservationError.message
			);

			errors.push({
				oponeoReservationId,
				error: reservationError.message,
				timestamp: new Date().toISOString(),
		});
	}

	// Close context and release browser back to pool
	if (context) {
		await context.close();
	}
	await browserPool.releaseBrowser();

	res.json({
		success: true,
		results: results,
		errors: errors,
	});
} catch (error) {
	logger.error('Error during obliteration process', {
		error: error.message,
		stack: error.stack,
	});

	// Cleanup on error
	if (context) {
		try {
			await context.close();
		} catch (e) {
			logger.error('Error closing context:', e.message);
		}
	}
	if (browser) {
		await browserPool.releaseBrowser();
	}

	res.status(500).json({
		success: false,
		error: error.message,
		details: 'An error occurred during the obliteration process',
		partial_results: results,
		errors,
	});
}
});

module.exports = router;
