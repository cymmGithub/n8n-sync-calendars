const winston = require('winston');

// Constants
const TICKS_PER_MILLISECOND = 10_000;
const EPOCH_TICKS_AT_UNIX_EPOCH = 621_355_968_000_000_000;

// Shared logger configuration
const logger = winston.createLogger({
	level: 'info',
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.json()
	),
	transports: [
		new winston.transports.File({ filename: 'error.log', level: 'error' }),
		new winston.transports.File({ filename: 'combined.log' }),
		new winston.transports.Console({
			format: winston.format.simple(),
		}),
	],
});

// General utility functions
const getCurrentDate = () => {
	return new Date().toISOString().split('T')[0];
};

// Oponeo-specific functions
async function authenticate_oponeo(page, email, password) {
	try {
		await page.goto(process.env.OPONEO_LOGIN_URL, {
			waitUntil: 'networkidle',
		});

		await page.fill('input[name="Login"]', email);
		await page.fill('input[name="Password"]', password);

		await page.click('a.button.enter');

		await page.waitForNavigation({ waitUntil: 'networkidle' });

		const current_url = page.url();
		if (current_url.includes('logowanie')) {
			throw new Error('Login failed - still on login page');
		}

		logger.info('Successfully logged in to Oponeo');
		return true;
	} catch (error) {
		logger.error(`Authentication failed: ${error.message}`);
		throw error;
	}
}

async function scrape_reservations_list(page) {
	try {
		// Extract all reservations from the current page and filter
		// for 'R' prefix which at this moment indicates reservation from oponeo
		const reservations = await page.evaluate(() => {
			const rows = Array.from(document.querySelectorAll('.table .row'));
			return rows
				.map((row) => {
					const reservation_number = row
						.querySelector('.reservationNumber .content')
						?.textContent.trim();
					const licence_plate = row
						.querySelector('.registrationNumber .content')
						?.textContent.trim();
					// Only include if reservation number starts with 'R' or licence plate = 'KAKTUSXXX' for debugging purposes
					if (
						!licence_plate.startsWith('KAKTUSXXX') &&
						!reservation_number.startsWith('R')
					) {
						return null;
					}

					return {
						reservation_url: row.querySelector('a.reservationNumber')?.href,
						reservation_number,
					};
				})
				.filter((reservation) => reservation !== null);
		});

		logger.info(
			`Found ${reservations.length} reservations starting with 'R' on current page`
		);
		return reservations;
	} catch (error) {
		logger.error(`Error scraping reservations list: ${error.message}`);
		throw error;
	}
}

async function get_all_pages_reservations(page) {
	try {
		const all_reservations = [];
		let current_page = 1;
		const reservations_from_now_url = get_reservations_from_now_url();

		const total_pages = await page.evaluate(() => {
			const pager_items = Array.from(
				document.querySelectorAll(
					'.pager li:not(:has(a[ajaxsubmit="NextPage"]))'
				)
			);

			if (pager_items.length === 0) {
				console.log('No pagination found, assuming single page');
				return 1;
			}

			const last_page_item = pager_items
				.filter((item) => /^\d+$/.test(item.textContent.trim()))
				.pop();

			if (!last_page_item) {
				console.log(
					'Could not find last numeric page item, assuming single page'
				);
				return 1;
			}

			const page_text = last_page_item.textContent.trim();
			const page_number = parseInt(page_text) || 1;

			return page_number;
		});

		logger.info(`Total pages detected: ${total_pages}`);

		logger.info(`Processing page ${current_page}/${total_pages}`);
		const first_page_reservations = await scrape_reservations_list(page);
		all_reservations.push(...first_page_reservations);

		while (current_page < total_pages) {
			current_page++;

			logger.info(`Navigating to page ${current_page}/${total_pages}`);
			const next_page_url = `${reservations_from_now_url}&strona=${current_page}`;
			await page.goto(next_page_url, { waitUntil: 'networkidle' });

			logger.info(`Processing page ${current_page}/${total_pages}`);
			const page_reservations = await scrape_reservations_list(page);
			all_reservations.push(...page_reservations);
		}

		logger.info(
			`Processed ${total_pages} pages with ${all_reservations.length} reservations`
		);
		return {
			reservations: all_reservations,
			stats: {
				total_pages,
				filtered_count: all_reservations.length,
				pages_processed: total_pages,
			},
		};
	} catch (error) {
		logger.error(`Pagination error: ${error.message}`);
		throw error;
	}
}

async function scrape_reservation_details(page, reservation_url) {
	try {
		await page.goto(reservation_url, { waitUntil: 'networkidle' });

		logger.info(`Processing Oponeo reservation: ${reservation_url}`);

		const details = await page.evaluate(() => {
			const get_produkty_text_content = () => {
				const produkty = Array.from(
					document.querySelectorAll('div.title')
				).find((el) => el.textContent?.trim() === 'Produkty');
				if (!produkty) return null;
				const description = produkty.nextElementSibling;

				return description?.textContent?.trim() || null;
			};
			const get_labels_text_content = (label_text) => {
				const labels = Array.from(document.querySelectorAll('p label'));
				const label = labels.find((l) => l.textContent.trim() === label_text);
				if (!label) return '';
				const parent_p = label.closest('p');
				if (!parent_p) return '';

				return parent_p.textContent.replace(label_text, '').trim();
			};

			return {
				reservation_number: get_labels_text_content('Numer rezerwacji:'),
				date: get_labels_text_content('Data:'),
				time: get_labels_text_content('Godzina:'),
				position: get_labels_text_content('Stanowisko:'),
				description: get_produkty_text_content(),
				client_name: get_labels_text_content('Imię i nazwisko:'),
				phone: get_labels_text_content('Nr telefonu:'),
				registration_number: get_labels_text_content('Nr rejestracyjny:'),
				email: get_labels_text_content('E-mail:'),
			};
		});

		return details;
	} catch (error) {
		logger.error(`Error scraping reservation details: ${error.message}`);
		throw error;
	}
}

const get_reservations_from_now_url = () => {
	const reservations_base_url = process.env.OPONEO_RESERVATIONS_LIST_URL;
	const js_now = new Date();
	// for debugging
	// const some_time_ago= new Date(js_now.getTime() - 40 * 24 * 60 * 60 * 1000);
	const dot_net_now =
		js_now.getTime() * TICKS_PER_MILLISECOND + EPOCH_TICKS_AT_UNIX_EPOCH;
	console.log('dot_net_now', dot_net_now);

	return `${reservations_base_url}?data-od=${dot_net_now}`;
};

// Helper function to convert .NET ticks to date
const convertTicksToDate = (ticks) => {
	const milliseconds =
		(ticks - EPOCH_TICKS_AT_UNIX_EPOCH) / TICKS_PER_MILLISECOND;
	return new Date(milliseconds);
};

const formatTime = (date) => {
	const hours = String(date.getUTCHours()).padStart(2, '0');
	const minutes = String(date.getUTCMinutes()).padStart(2, '0');
	return `${hours}:${minutes}`;
};

function isoToTicks(isoString) {
	// Remove timezone info if present and parse as local time
	const cleanIsoString = isoString.replace(/[+-]\d{2}:\d{2}$|Z$/, '');
	const date = new Date(cleanIsoString);

	// Ensure we're working with valid date
	if (isNaN(date.getTime())) {
		throw new Error(`Invalid ISO string: ${isoString}`);
	}

	const ms = BigInt(date.getTime());
	return ms * BigInt(TICKS_PER_MILLISECOND) + BigInt(EPOCH_TICKS_AT_UNIX_EPOCH);
}

module.exports = {
	// Constants
	TICKS_PER_MILLISECOND,
	EPOCH_TICKS_AT_UNIX_EPOCH,

	// Shared utilities
	logger,
	getCurrentDate,

	// Oponeo functions
	authenticate_oponeo,
	scrape_reservations_list,
	get_all_pages_reservations,
	scrape_reservation_details,
	get_reservations_from_now_url,
	convertTicksToDate,
	formatTime,
	isoToTicks,
};