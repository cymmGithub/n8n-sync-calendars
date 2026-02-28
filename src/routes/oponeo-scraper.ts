import { Router } from 'express';
import type { Request, Response } from 'express';
import {
	authenticateOponeo,
	getAllPagesReservations,
	scrapeReservationDetails,
} from '../scrapers/oponeo.js';
import { browserPool } from '../services/browser-pool.js';
import {
	convertTicksToDate,
	formatTime,
	getTimeSlotIndex,
	getReservationsFromNowUrl,
} from '../utils/dates.js';
import { randomDelay } from '../utils/browser.js';
import { logger } from '../utils/logger.js';
import type {
	MutatorReservation,
	MutatorResult,
	ObliteratorResult,
	OperationSummary,
} from '../types/index.js';

const router = Router();

router.post('/scraper', async (req: Request, res: Response): Promise<void> => {
	const url = process.env['OPONEO_BASE_URL'];
	const { debug_mode = false } = req.body as {
		debug_mode?: boolean;
	};
	const email = process.env['OPONEO_EMAIL'];
	const password = process.env['OPONEO_PASSWORD'];

	if (!email || !password) {
		res.status(400).send('Email and password are required');
		return;
	}

	try {
		// Use browser pool with context management
		const { page, isAuthenticated } = await browserPool.getContext(debug_mode);

		// Authenticate only if not already authenticated
		if (!isAuthenticated) {
			await authenticateOponeo(page, email, password);
			browserPool.markAsAuthenticated();
		} else {
			logger.info('Reusing authenticated session');
		}

		const reservationsFromNowUrl = getReservationsFromNowUrl();

		logger.info(`Accessing reservations with URL: ${reservationsFromNowUrl}`);
		await page.goto(reservationsFromNowUrl, {
			waitUntil: 'load',
		});

		const reservationsData = await getAllPagesReservations(page);
		logger.info(
			`Found ${reservationsData.reservations.length.toString()} reservations across all pages`,
		);

		const detailedReservations: Array<{
			reservation_url: string | null;
			reservation_number: string;
			details: Awaited<ReturnType<typeof scrapeReservationDetails>>;
		}> = [];
		let processed = 0;
		let skipped = 0;

		for (const reservation of reservationsData.reservations) {
			if (reservation.reservation_url) {
				processed++;
				logger.info(
					`Processing reservation ${processed.toString()}/${reservationsData.reservations.length.toString()}: ${reservation.reservation_number}`,
				);

				const details = await scrapeReservationDetails(
					page,
					reservation.reservation_url,
				);

				// only add reservations that returned details (those with "Rezerwacja oponeo")
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
				if (details) {
					detailedReservations.push({
						...reservation,
						details,
					});
					logger.info(
						`Added reservation ${reservation.reservation_number} to results`,
					);
				} else {
					skipped++;
					logger.info(
						`Skipped reservation ${reservation.reservation_number} - not an Oponeo reservation`,
					);
				}
			}
		}

		logger.info(
			`Reservation processing complete: Total processed: ${processed.toString()}, Included: ${detailedReservations.length.toString()}, Skipped: ${skipped.toString()}`,
		);

		// Release context back to pool (keep it alive for potential reuse)
		browserPool.releaseContext();

		const finalStats = {
			pagination: reservationsData.stats,
			processing: {
				total_processed: processed,
				included: detailedReservations.length,
				skipped: skipped,
			},
		};

		logger.info('Successfully scraped data after authentication', {
			url: url ?? 'https://autoserwis.oponeo.pl/',
			data_keys: Object.keys(detailedReservations),
			stats: finalStats,
		});

		res.json({
			success: true,
			data: detailedReservations,
			stats: finalStats,
		});
	} catch (error) {
		logger.error('Error during scraping process', {
			error: error instanceof Error ? error.message : 'Unknown error',
			stack: error instanceof Error ? error.stack : undefined,
		});

		// Release context on error (let pool manage cleanup)
		browserPool.releaseContext();

		res.status(500).json({
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
			details: 'An error occurred during the scraping process',
		});
	}
});

router.post('/mutator', async (req: Request, res: Response): Promise<void> => {
	const { debug_mode = false, reservations = [] } = req.body as {
		debug_mode?: boolean;
		reservations?: MutatorReservation[];
	};
	const email = process.env['OPONEO_EMAIL'];
	const password = process.env['OPONEO_PASSWORD'];

	if (!email || !password) {
		res.status(400).send('Email and password are required');
		return;
	}

	// Handle empty array case - this is totally fine
	if (reservations.length === 0) {
		logger.info('No reservations to process - empty array provided');
		res.json({
			success: true,
			results: [],
			errors: [],
			metadata: {
				timestamp: new Date().toISOString(),
				processed: 0,
				message: 'No reservations to process',
			},
		});
		return;
	}

	const results: MutatorResult[] = [];
	const errors: MutatorResult[] = [];

	try {
		// Use browser pool with context management
		const { page, isAuthenticated } = await browserPool.getContext(debug_mode);

		// Authenticate only if not already authenticated
		if (!isAuthenticated) {
			await authenticateOponeo(page, email, password);
			browserPool.markAsAuthenticated();
			logger.info('Authentication successful, starting reservation mutations');
		} else {
			logger.info(
				'Reusing authenticated session, starting reservation mutations',
			);
		}

		// Process each reservation
		for (let i = 0; i < reservations.length; i++) {
			const reservation = reservations[i];
			logger.info(
				`Processing reservation ${(i + 1).toString()}/${reservations.length.toString()}:`,
				reservation,
			);
			let reservationId: string | undefined;

			// Convert .NET ticks to dates
			const startDate = convertTicksToDate(reservation.startDate);
			const endDate = convertTicksToDate(reservation.endDate);

			// Format for URL (YYYY-MM-DD format but we need ticks for the URL)
			const startDateTicks = reservation.startDate;
			const endDateHour = formatTime(endDate); // e.g., "14:20"

			const licencePlate = reservation.licencePlate ?? 'WO';
			const phoneNumber = reservation.phoneNumber ?? 'WO';

			try {
				logger.info(
					`Creating reservation for ${licencePlate} at ${startDate.toISOString()} - ${endDate.toISOString()}`,
				);

				// Navigate to new reservation page with start date
				const reservationUrl = `https://autoserwis.oponeo.pl/nowa-rezerwacja?data-od=${startDateTicks.toString()}&stanowisko=3166`;
				await page.goto(reservationUrl, {
					waitUntil: 'load',
				});

				// Set end time
				logger.info(`Setting end time to: ${endDateHour}`);
				await randomDelay(200, 500);
				await page.locator('input[name="DateChoose\\.TimeTo"]').click();

				// there is a different html structure for the last available hour for current day
				const timeSlotIndex = getTimeSlotIndex(endDateHour, endDate);
				const timeSlotLocator = page
					.locator('div.hours > div')
					.filter({
						hasText: new RegExp(`^${endDateHour}$`),
					})
					.nth(timeSlotIndex);

				const isDisabled = (
					await timeSlotLocator.getAttribute('class', { timeout: 10000 })
				)?.includes('disabled');

				if (isDisabled) {
					throw new Error(
						`HOUR_CONFLICT - Time slot ${endDateHour} is disabled.`,
					);
				}

				try {
					await randomDelay(100, 300);
					await timeSlotLocator.click({
						timeout: 1000,
					});
				} catch (clickError) {
					logger.error(`Failed to click time slot ${endDateHour}`, {
						error: clickError,
					});
					throw new Error(
						`CLICK_FAILED - Could not click time slot ${endDateHour}. It might be obscured or not interactive.`,
						{ cause: clickError },
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
					.filter({
						hasText: /^Dodaj rezerwację$/,
					})
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
				} catch {
					throw new Error(
						'CREATION_FAILED - Success message not found or reservation ID could not be extracted.',
					);
				}
			} catch (reservationError) {
				logger.error(
					`Failed to create reservation ${(i + 1).toString()}:`,
					reservationError instanceof Error
						? reservationError.message
						: 'Unknown error',
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
					error:
						reservationError instanceof Error
							? reservationError.message
							: 'Unknown error',
					timestamp: new Date().toISOString(),
					success: false,
				});

				// Continue with next reservation
				continue;
			}
		}

		// Release context back to pool (keep it alive for potential reuse)
		browserPool.releaseContext();

		const summary: OperationSummary = {
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
			error: error instanceof Error ? error.message : 'Unknown error',
			stack: error instanceof Error ? error.stack : undefined,
		});

		// Release context on error (let pool manage cleanup)
		browserPool.releaseContext();

		res.status(500).json({
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
			details: 'An error occurred during the mutation process',
			partial_results: results,
			errors: errors,
		});
	}
});

router.post(
	'/obliterator',
	async (req: Request, res: Response): Promise<void> => {
		const { debug_mode = false, oponeoReservationIds = [] } = req.body as {
			debug_mode?: boolean;
			oponeoReservationIds?: string[];
		};
		const email = process.env['OPONEO_EMAIL'];
		const password = process.env['OPONEO_PASSWORD'];

		if (!email || !password) {
			res.status(400).send('Email and password are required');
			return;
		}

		// Handle empty array case - this is totally fine
		if (oponeoReservationIds.length === 0) {
			logger.info('No reservations to obliterate - empty array provided');
			res.json({
				success: true,
				results: [],
				errors: [],
				metadata: {
					timestamp: new Date().toISOString(),
					processed: 0,
					message: 'No reservations to obliterate',
				},
			});
			return;
		}

		const results: ObliteratorResult[] = [];
		const errors: ObliteratorResult[] = [];

		try {
			// Use browser pool with context management
			const { page, isAuthenticated } =
				await browserPool.getContext(debug_mode);

			// Authenticate only if not already authenticated
			if (!isAuthenticated) {
				await authenticateOponeo(page, email, password);
				browserPool.markAsAuthenticated();
				logger.info(
					'Authentication successful, starting reservation obliteration',
				);
			} else {
				logger.info(
					'Reusing authenticated session, starting reservation obliteration',
				);
			}

			// Process each reservation
			for (let i = 0; i < oponeoReservationIds.length; i++) {
				const oponeoReservationId = oponeoReservationIds[i];
				logger.info(
					`Processing obliteration ${(i + 1).toString()}/${oponeoReservationIds.length.toString()}: ${oponeoReservationId}`,
				);

				try {
					if (!oponeoReservationId) {
						throw new Error('MISSING_ID - oponeoReservationId is required');
					}

					// Navigate to the reservation edit page
					const editUrl = `https://autoserwis.oponeo.pl/edycja-rezerwacji/${oponeoReservationId}`;
					logger.info(`Navigating to: ${editUrl}`);

					await page.goto(editUrl, {
						waitUntil: 'load',
					});

					// Wait a moment for the page to fully load
					await page.waitForTimeout(1000);

					await page
						.getByRole('link', {
							name: 'Usuń rezerwację',
						})
						.click();
					await page.getByText('Usuń', { exact: true }).click();

					// Wait for navigation or network to settle instead of fixed timeout
					await page
						.waitForLoadState('networkidle', {
							timeout: 5000,
						})
						.catch(() => {
							logger.warn('Network idle timeout - continuing with cleanup');
						});

					results.push({
						index: i,
						success: true,
						oponeoReservationId,
						message: `Successfully obliterated ${oponeoReservationId}`,
						timestamp: new Date().toISOString(),
					});

					logger.info(
						`Successfully obliterated reservation ${oponeoReservationId}`,
					);
				} catch (reservationError) {
					logger.error(
						`Failed to obliterate reservation ${(i + 1).toString()}:`,
						reservationError instanceof Error
							? reservationError.message
							: 'Unknown error',
					);

					errors.push({
						index: i,
						success: false,
						oponeoReservationId,
						error:
							reservationError instanceof Error
								? reservationError.message
								: 'Unknown error',
						timestamp: new Date().toISOString(),
					});

					// Continue with next reservation
					continue;
				}
			}

			// Release context back to pool (keep it alive for next endpoint)
			browserPool.releaseContext();

			const summary: OperationSummary = {
				total: oponeoReservationIds.length,
				successful: results.length,
				failed: errors.length,
				success_rate:
					((results.length / oponeoReservationIds.length) * 100).toFixed(2) +
					'%',
			};

			logger.info('Obliteration process complete:', summary);

			res.json({
				success: true,
				summary: summary,
				results: results,
				errors: errors,
				metadata: {
					timestamp: new Date().toISOString(),
					processed: oponeoReservationIds.length,
					authentication: 'successful',
				},
			});
		} catch (error) {
			logger.error('Error during obliteration process', {
				error: error instanceof Error ? error.message : 'Unknown error',
				stack: error instanceof Error ? error.stack : undefined,
			});

			// Release context on error (let pool manage cleanup)
			browserPool.releaseContext();

			res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
				details: 'An error occurred during the obliteration process',
				partial_results: results,
				errors: errors,
			});
		}
	},
);

export default router;
