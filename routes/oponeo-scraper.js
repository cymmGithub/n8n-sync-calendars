const express = require('express');
const { chromium } = require('playwright');
const {
	logger,
	authenticate_oponeo,
	get_all_pages_reservations,
	scrape_reservation_details,
	get_reservations_from_now_url,
	convertTicksToDate,
	formatTime,
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
	try {
		const browser_options = {
			headless: true,
		};

		browser = await chromium.launch(browser_options);
		const context = await browser.newContext({
			viewport: { width: 1920, height: 1080 },
		});
		const page = await context.newPage();

		if (debug_mode) {
			page.on('console', (msg) => console.log('Browser console:', msg.text()));
			page.on('pageerror', (err) => console.error('Browser page error:', err));
		}

		await authenticate_oponeo(page, email, password);

		const reservations_from_now_url = get_reservations_from_now_url();

		logger.info(
			`Accessing reservations with URL: ${reservations_from_now_url}`
		);
		await page.goto(reservations_from_now_url, { waitUntil: 'domcontentloaded' });

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

		await browser.close();

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

		if (browser) {
			await browser.close();
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

	if (!Array.isArray(reservations)) {
		return res.status(400).json({
			success: false,
			error: 'Reservations must be an array',
		});
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
	const results = [];
	const errors = [];

	try {
		const browser_options = {
			headless: !debug_mode, // Show browser when debugging
		};

		browser = await chromium.launch(browser_options);
		const context = await browser.newContext({
			viewport: { width: 1920, height: 1080 },
		});
		const page = await context.newPage();

		if (debug_mode) {
			page.on('console', (msg) => console.log('Browser console:', msg.text()));
			page.on('pageerror', (err) => console.error('Browser page error:', err));
		}

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

			try {
				// Convert .NET ticks to dates
				const startDate = convertTicksToDate(reservation.startDate);
				const endDate = convertTicksToDate(reservation.endDate);

				// Format for URL (YYYY-MM-DD format but we need ticks for the URL)
				const startDateTicks = reservation.startDate;
				const endDateHour = formatTime(endDate); // e.g., "14:20"

				const licencePlate = reservation.licencePlate || 'WO';
				const phoneNumber = reservation.phoneNumber || 'WO';

				logger.info(
					`Creating reservation for ${licencePlate} at ${startDate.toISOString()} - ${endDate.toISOString()}`
				);

				// Navigate to new reservation page with start date
				const reservationUrl = `https://autoserwis.oponeo.pl/nowa-rezerwacja?data-od=${startDateTicks}&stanowisko=3166`;
				await page.goto(reservationUrl, { waitUntil: 'domcontentloaded' });

				// Set end time
				logger.info(`Setting end time to: ${endDateHour}`);
				await page.locator('input[name="DateChoose\\.TimeTo"]').click();

				const endDateLocator = page.getByText(endDateHour).nth(1);

				try {
					await endDateLocator.waitFor({ state: 'attached', timeout: 1000 });
				} catch (timeoutError) {
					throw new Error('HOUR_CONFLICT - End time slot not available');
				}

				// Check if the element has the disabled class
				const elementClass = await endDateLocator.getAttribute('class');
				if (elementClass && elementClass.includes('disabled')) {
					throw new Error('HOUR_CONFLICT - End time slot is disabled');
				}

				// Also check if element is actually clickable (visible and enabled)
				try {
					await endDateLocator.waitFor({ state: 'visible', timeout: 1000 });
				} catch (visibilityError) {
					throw new Error('HOUR_CONFLICT - End time slot is not clickable');
				}

				await endDateLocator.click();

				// Fill vehicle registration number
				await page.locator('input[name="VehicleRegistrationNumber"]').click();
				await page
					.locator('input[name="VehicleRegistrationNumber"]')
					.fill(licencePlate);

				// Fill client first name (using phone number as requested)
				await page.locator('input[name="ClientFirstName"]').click();
				await page.locator('input[name="ClientFirstName"]').fill(phoneNumber);

				// Submit the reservation
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

					results.push({
						index: i,
						success: true,
						reservation: reservation,
						message: 'Reservation created successfully',
						licencePlate: licencePlate,
						phoneNumber: phoneNumber,
						startTime: startDate.toISOString(),
						endTime: endDate.toISOString(),
					});
				} catch (successError) {
					throw new Error('CREATION_FAILED - Success message not found');
				}
			} catch (reservationError) {
				logger.error(
					`Failed to create reservation ${i + 1}:`,
					reservationError.message
				);

				errors.push({
					index: i,
					reservation: reservation,
					error: reservationError.message,
					timestamp: new Date().toISOString(),
				});

				// Continue with next reservation
				continue;
			}
		}

		await browser.close();

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

		if (browser) {
			await browser.close();
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

module.exports = router;
