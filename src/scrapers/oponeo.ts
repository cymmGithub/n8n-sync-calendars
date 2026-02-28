/* eslint-disable @typescript-eslint/no-unnecessary-condition -- DOM queries in page.evaluate() may return null at runtime */
import type { Page } from 'playwright';
import { logger } from '../utils/logger.js';
import { getReservationsFromNowUrl } from '../utils/dates.js';
import type {
	ReservationListItem,
	ReservationDetails,
	PaginatedReservations,
} from '../types/index.js';

export async function authenticateOponeo(
	page: Page,
	email: string,
	password: string,
): Promise<boolean> {
	try {
		await page.goto(process.env['OPONEO_LOGIN_URL']!, {
			waitUntil: 'load',
			timeout: 60000,
		});

		await page.fill('input[name="Login"]', email);
		await page.fill('input[name="Password"]', password);

		await Promise.all([
			page.click('a.button.enter', { timeout: 60000 }),
			page.waitForURL((url) => !url.pathname.includes('logowanie'), {
				waitUntil: 'load',
				timeout: 60000,
			}),
		]);

		const currentUrl = page.url();
		if (currentUrl.includes('logowanie')) {
			throw new Error('Login failed - still on login page');
		}

		logger.info('Successfully logged in to Oponeo');
		return true;
	} catch (error) {
		logger.error(
			`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
		throw error;
	}
}

export async function scrapeReservationsList(
	page: Page,
): Promise<ReservationListItem[]> {
	try {
		// Extract all reservations from the current page and filter
		// for 'R' prefix which at this moment indicates reservation from oponeo
		const reservations = await page.evaluate(() => {
			const rows = Array.from(document.querySelectorAll('.table .row'));
			return rows
				.map((row) => {
					const reservationNumber = row
						.querySelector('.reservationNumber .content')
						?.textContent?.trim();
					const licencePlate = row
						.querySelector('.registrationNumber .content')
						?.textContent?.trim();
					// Only include if reservation number starts with 'R' or licence plate = 'KAKTUSXXX' for debugging purposes
					if (
						!licencePlate?.startsWith('KAKTUSXXX') &&
						!reservationNumber?.startsWith('R')
					) {
						return null;
					}

					return {
						reservation_url:
							row.querySelector<HTMLAnchorElement>('a.reservationNumber')
								?.href ?? null,
						reservation_number: reservationNumber ?? '',
					};
				})
				.filter(
					(reservation): reservation is NonNullable<typeof reservation> =>
						reservation !== null,
				);
		});

		logger.info(
			`Found ${reservations.length.toString()} reservations starting with 'R' on current page`,
		);
		return reservations;
	} catch (error) {
		logger.error(
			`Error scraping reservations list: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
		throw error;
	}
}

export async function getAllPagesReservations(
	page: Page,
): Promise<PaginatedReservations> {
	try {
		const allReservations: ReservationListItem[] = [];
		let currentPage = 1;
		const reservationsFromNowUrl = getReservationsFromNowUrl();

		const totalPages = await page.evaluate(() => {
			const pagerItems = Array.from(
				document.querySelectorAll(
					'.pager li:not(:has(a[ajaxsubmit="NextPage"]))',
				),
			);

			if (pagerItems.length === 0) {
				console.log('No pagination found, assuming single page');
				return 1;
			}

			const lastPageItem = pagerItems
				.filter((item) => /^\d+$/.test(item.textContent?.trim() ?? ''))
				.pop();

			if (!lastPageItem) {
				console.log(
					'Could not find last numeric page item, assuming single page',
				);
				return 1;
			}

			const pageText = lastPageItem.textContent?.trim() ?? '';
			const pageNumber = parseInt(pageText) || 1;

			return pageNumber;
		});

		logger.info(`Total pages detected: ${totalPages.toString()}`);

		logger.info(
			`Processing page ${currentPage.toString()}/${totalPages.toString()}`,
		);
		const firstPageReservations = await scrapeReservationsList(page);
		allReservations.push(...firstPageReservations);

		while (currentPage < totalPages) {
			currentPage++;

			logger.info(
				`Navigating to page ${currentPage.toString()}/${totalPages.toString()}`,
			);
			const nextPageUrl = `${reservationsFromNowUrl}&strona=${currentPage.toString()}`;
			await page.goto(nextPageUrl, { waitUntil: 'load' });

			logger.info(
				`Processing page ${currentPage.toString()}/${totalPages.toString()}`,
			);
			const pageReservations = await scrapeReservationsList(page);
			allReservations.push(...pageReservations);
		}

		logger.info(
			`Processed ${totalPages.toString()} pages with ${allReservations.length.toString()} reservations`,
		);
		return {
			reservations: allReservations,
			stats: {
				total_pages: totalPages,
				filtered_count: allReservations.length,
				pages_processed: totalPages,
			},
		};
	} catch (error) {
		logger.error(
			`Pagination error: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
		throw error;
	}
}

export async function scrapeReservationDetails(
	page: Page,
	reservationUrl: string,
): Promise<ReservationDetails> {
	try {
		await page.goto(reservationUrl, { waitUntil: 'load' });

		logger.info(`Processing Oponeo reservation: ${reservationUrl}`);

		const details = await page.evaluate(() => {
			const getProduktyTextContent = (): string | null => {
				const produkty = Array.from(
					document.querySelectorAll('div.title'),
				).find((el) => el.textContent?.trim() === 'Produkty');
				if (!produkty) return null;
				const description = produkty.nextElementSibling;

				return description?.textContent?.trim() ?? null;
			};
			const getLabelsTextContent = (labelText: string): string => {
				const labels = Array.from(document.querySelectorAll('p label'));
				const label = labels.find((l) => l.textContent?.trim() === labelText);
				if (!label) return '';
				const parentP = label.closest('p');
				if (!parentP) return '';

				return parentP.textContent?.replace(labelText, '').trim() ?? '';
			};

			return {
				reservation_number: getLabelsTextContent('Numer rezerwacji:'),
				date: getLabelsTextContent('Data:'),
				time: getLabelsTextContent('Godzina:'),
				position: getLabelsTextContent('Stanowisko:'),
				description: getProduktyTextContent(),
				client_name: getLabelsTextContent('Imię i nazwisko:'),
				phone: getLabelsTextContent('Nr telefonu:'),
				registration_number: getLabelsTextContent('Nr rejestracyjny:'),
				email: getLabelsTextContent('E-mail:'),
			};
		});

		return details;
	} catch (error) {
		logger.error(
			`Error scraping reservation details: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
		throw error;
	}
}
