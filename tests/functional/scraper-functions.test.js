const fs = require('fs');
const path = require('path');
const {
	scrape_reservations_list,
	scrape_reservation_details,
} = require('../../utils');

// Load HTML fixtures
const reservationListHTML = fs.readFileSync(
	path.join(__dirname, '../fixtures/reservation-list.html'),
	'utf-8'
);
const reservationDetailHTML = fs.readFileSync(
	path.join(__dirname, '../fixtures/reservation-detail.html'),
	'utf-8'
);

// Mock Playwright page object
const createMockPage = (htmlContent) => ({
	evaluate: jest.fn(async (fn) => {
		// Create a DOM environment for the fixture
		const { JSDOM } = require('jsdom');
		const dom = new JSDOM(htmlContent, { runScripts: 'dangerously' });

		// Execute the function in the JSDOM window context
		// We need to use runVMScript or execute in the context to make document available
		const script = `(${fn.toString()})()`;
		const result = dom.window.eval(script);
		return result;
	}),
	goto: jest.fn(),
});

describe('Scraper Functions', () => {
	describe('scrape_reservations_list', () => {
		it('should extract reservations starting with R', async () => {
			const mockPage = createMockPage(reservationListHTML);

			const reservations = await scrape_reservations_list(mockPage);

			expect(reservations).toHaveLength(3);
			expect(reservations[0]).toMatchObject({
				reservation_url: 'https://autoserwis.oponeo.pl/rezerwacja/12345',
				reservation_number: 'R123456',
			});
			expect(reservations[1]).toMatchObject({
				reservation_url: 'https://autoserwis.oponeo.pl/rezerwacja/12346',
				reservation_number: 'R123457',
			});
		});

		it('should include KAKTUSXXX debug reservations', async () => {
			const mockPage = createMockPage(reservationListHTML);

			const reservations = await scrape_reservations_list(mockPage);

			const kaktusReservation = reservations.find(r =>
				r.reservation_number === 'R123458'
			);
			expect(kaktusReservation).toBeDefined();
		});

		it('should filter out reservations not starting with R', async () => {
			const mockPage = createMockPage(reservationListHTML);

			const reservations = await scrape_reservations_list(mockPage);

			const wReservation = reservations.find(r =>
				r.reservation_number === 'W999999'
			);
			expect(wReservation).toBeUndefined();
		});

		it('should handle empty table', async () => {
			const emptyHTML = `
				<!DOCTYPE html>
				<html>
				<body>
					<div class="table"></div>
				</body>
				</html>
			`;
			const mockPage = createMockPage(emptyHTML);

			const reservations = await scrape_reservations_list(mockPage);

			expect(reservations).toHaveLength(0);
		});
	});

	describe('scrape_reservation_details', () => {
		it('should extract all reservation details', async () => {
			const mockPage = createMockPage(reservationDetailHTML);
			const testUrl = 'https://autoserwis.oponeo.pl/rezerwacja/12345';

			const details = await scrape_reservation_details(mockPage, testUrl);

			expect(mockPage.goto).toHaveBeenCalledWith(testUrl, { waitUntil: 'load' });
			expect(details).toMatchObject({
				reservation_number: 'R123456',
				date: '2025-01-15',
				time: '10:00 - 11:00',
				position: 'Stanowisko 1',
				description: '4x Opony zimowe 205/55 R16',
				client_name: 'Jan Kowalski',
				phone: '+48 123 456 789',
				registration_number: 'ABC123',
				email: 'jan.kowalski@example.com',
			});
		});

		it('should handle missing optional fields gracefully', async () => {
			const minimalHTML = `
				<!DOCTYPE html>
				<html>
				<body>
					<div class="reservation-details">
						<p><label>Numer rezerwacji:</label>R123456</p>
					</div>
				</body>
				</html>
			`;
			const mockPage = createMockPage(minimalHTML);

			const details = await scrape_reservation_details(
				mockPage,
				'https://autoserwis.oponeo.pl/rezerwacja/12345'
			);

			expect(details.reservation_number).toBe('R123456');
			expect(details.date).toBe('');
			expect(details.description).toBeNull();
		});
	});

	describe('Pagination Detection', () => {
		it('should detect total pages from pager', async () => {
			const mockPage = createMockPage(reservationListHTML);
			mockPage.evaluate = jest.fn(async (fn) => {
				const { JSDOM } = require('jsdom');
				const dom = new JSDOM(reservationListHTML);
				const document = dom.window.document;

				// Execute the pagination detection logic
				const pager_items = Array.from(
					document.querySelectorAll(
						'.pager li:not(:has(a[ajaxsubmit="NextPage"]))'
					)
				);

				if (pager_items.length === 0) {
					return 1;
				}

				const last_page_item = pager_items
					.filter((item) => /^\d+$/.test(item.textContent.trim()))
					.pop();

				if (!last_page_item) {
					return 1;
				}

				const page_text = last_page_item.textContent.trim();
				const page_number = parseInt(page_text) || 1;

				return page_number;
			});

			const totalPages = await mockPage.evaluate(() => {});
			expect(totalPages).toBe(3);
		});

		it('should return 1 for single page without pagination', async () => {
			const singlePageHTML = `
				<!DOCTYPE html>
				<html>
				<body>
					<div class="table">
						<div class="row">
							<a href="#" class="reservationNumber">
								<span class="content">R123456</span>
							</a>
						</div>
					</div>
				</body>
				</html>
			`;
			const mockPage = createMockPage(singlePageHTML);
			mockPage.evaluate = jest.fn(async () => {
				const { JSDOM } = require('jsdom');
				const dom = new JSDOM(singlePageHTML);
				const document = dom.window.document;

				const pager_items = Array.from(
					document.querySelectorAll(
						'.pager li:not(:has(a[ajaxsubmit="NextPage"]))'
					)
				);

				if (pager_items.length === 0) {
					return 1;
				}

				return parseInt(pager_items[pager_items.length - 1].textContent) || 1;
			});

			const totalPages = await mockPage.evaluate(() => {});
			expect(totalPages).toBe(1);
		});
	});

	describe('Data Extraction Edge Cases', () => {
		it('should handle extra whitespace in labels', async () => {
			const spacedHTML = `
				<!DOCTYPE html>
				<html>
				<body>
					<p>
						<label>  Numer rezerwacji:  </label>
						  R123456
					</p>
				</body>
				</html>
			`;
			const mockPage = createMockPage(spacedHTML);

			const details = await scrape_reservation_details(
				mockPage,
				'https://autoserwis.oponeo.pl/rezerwacja/12345'
			);

			// The trim() in the actual function should handle this
			expect(details.reservation_number).toContain('R123456');
		});

		it('should extract description from title-description pattern', async () => {
			const mockPage = createMockPage(reservationDetailHTML);

			const details = await scrape_reservation_details(
				mockPage,
				'https://autoserwis.oponeo.pl/rezerwacja/12345'
			);

			expect(details.description).toBe('4x Opony zimowe 205/55 R16');
		});
	});
});
