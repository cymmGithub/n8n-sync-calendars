require('dotenv').config();
const express = require('express');
const { chromium } = require('playwright');
const winston = require('winston');
const fs = require('fs');
const path = require('path');

const TICKS_PER_MILLISECOND = 10_000;
const EPOCH_TICKS_AT_UNIX_EPOCH = 621_355_968_000_000_000;

const logger = winston.createLogger({
	level: 'info',
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.json()
	),
	transports: [
		new winston.transports.File({ filename: 'error.log', level: 'error' }),
		new winston.transports.File({ filename: 'combined.log' }),
	],
});

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());

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
					if ((!licence_plate.startsWith('KAKTUSXXX') && !reservation_number.startsWith('R'))) {
						return null;
					}

					return {
						reservation_url: row.querySelector('a.reservationNumber')?.href,
						reservation_number,
					};
				})
				.filter(reservation => reservation !== null);
		});

		logger.info(`Found ${reservations.length} reservations starting with 'R' on current page`);
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
			const pager_items = Array.from(document.querySelectorAll('.pager li:not(:has(a[ajaxsubmit="NextPage"]))'));

			if (pager_items.length === 0) {
				console.log('No pagination found, assuming single page');
				return 1;
			}

			const last_page_item = pager_items
				.filter(item => /^\d+$/.test(item.textContent.trim()))
				.pop();

			if (!last_page_item) {
				console.log('Could not find last numeric page item, assuming single page');
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

		logger.info(`Processed ${total_pages} pages with ${all_reservations.length} reservations`);
		return {
			reservations: all_reservations,
			stats: {
				total_pages,
				filtered_count: all_reservations.length,
				pages_processed: total_pages
			}
		};
	} catch (error) {
		logger.error(`Pagination error: ${error.message}`);
		throw error;
	}
}

async function scrape_reservation_details(page, reservation_url, debug_mode = false) {
	try {
		await page.goto(reservation_url, { waitUntil: 'networkidle' });

		logger.info(`Processing Oponeo reservation: ${reservation_url}`);

		const details = await page.evaluate(() => {
			const get_produkty_text_content = () => {
				const produkty = Array.from(document.querySelectorAll('div.title'))
				.find(el => el.textContent?.trim() === 'Produkty');
				if (!produkty) return null;
				const description = produkty.nextElementSibling;

				return description?.textContent?.trim() || null;
			}
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
				description: `
					${get_labels_text_content('Wybrany model:')}\n
					${get_labels_text_content('Kwota pobrania:')}\n
					${get_produkty_text_content()}
				`,
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

function get_formatted_date(local_date) {
	const warsaw_formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Europe/Warsaw',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	});

	const [
		{ value: month },,
		{ value: day },,
		{ value: year },,
		{ value: hour },,
		{ value: minute },,
		{ value: second }
	] = warsaw_formatter.formatToParts(local_date);

	return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`);
}

function transform_to_wo_format(reservation) {
	const [start, end] = reservation.details.time.split(' - ');

	// parse date components from DD-MM-YYYY format
	const [day, month, year] = reservation.details.date.split('-').map(Number);
	const [startHour, startMinute] = start.split(':').map(Number);
	const [endHour, endMinute] = end.split(':').map(Number);

	// create dates using explicit parameter, month is 0-indexed, (January = 0, December = 11)
	const local_start_date = new Date(year, month - 1, day, startHour, startMinute);
	const local_end_date = new Date(year, month - 1, day, endHour, endMinute);

	const start_date_time = get_formatted_date(local_start_date);
	const end_date_time = get_formatted_date(local_end_date);

	return {
		id: parseInt(reservation.details.reservation_number.replace(/\D/g, '')),
		description: reservation.details.description || '',
		customerName: reservation.details.client_name || ' ',
		startDate: start_date_time.toISOString(),
		endDate: end_date_time.toISOString(),
		date: reservation.details.date,
		workspace: {
			id: 13096,
			name: 'Opony',
		},
		licencePlate: reservation.details.registration_number || '',
		prefix: '+48',
		phoneNumber: reservation.details.phone.replace(/\D/g, '') || '',
		email: reservation.details.email || '',
		url: reservation.reservation_url || '',
	};
}

const get_reservations_from_now_url = () => {
	const reservations_base_url = process.env.OPONEO_RESERVATIONS_LIST_URL
	const js_now = new Date();
	// for debugging
	// const some_time_ago= new Date(js_now.getTime() - 40 * 24 * 60 * 60 * 1000);
	const dot_net_now = js_now.getTime() * TICKS_PER_MILLISECOND + EPOCH_TICKS_AT_UNIX_EPOCH;
	console.log("dot_net_now", dot_net_now);

	return `${reservations_base_url}?data-od=${dot_net_now}`;

}

app.post('/scrape-oponeo', async (req, res) => {
	const url = process.env.OPONEO_BASE_URL;
	const {
		email,
		password,
		debug_mode = true,
	} = req.body;

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

		logger.info(`Accessing reservations with URL: ${reservations_from_now_url}`);
		await page.goto(reservations_from_now_url, { waitUntil: 'networkidle' });

		// Use the new function to get reservations from all pages
		const reservations_data = await get_all_pages_reservations(page);
		logger.info(`Found ${reservations_data.reservations.length} reservations across all pages`);

		const detailed_reservations = [];
		let processed = 0;
		let skipped = 0;

		for (const reservation of reservations_data.reservations) {
			if (reservation.reservation_url) {
				processed++;
				logger.info(`Processing reservation ${processed}/${reservations_data.reservations.length}: ${reservation.reservation_number}`);

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
					logger.info(`Added reservation ${reservation.reservation_number} to results`);
				} else {
					skipped++;
					logger.info(`Skipped reservation ${reservation.reservation_number} - not an Oponeo reservation`);
				}
			}
		}

		logger.info(`Reservation processing complete: Total processed: ${processed}, Included: ${detailed_reservations.length}, Skipped: ${skipped}`);

		await browser.close();

		const final_stats = {
			pagination: reservations_data.stats,
			processing: {
				total_processed: processed,
				included: detailed_reservations.length,
				skipped: skipped
			}
		};

		logger.info('Successfully scraped data after authentication', {
			url: url || 'https://autoserwis.oponeo.pl/',
			data_keys: Object.keys(detailed_reservations),
			stats: final_stats
		});

		res.json({
			success: true,
			data: detailed_reservations,
			stats: final_stats
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

const server = app.listen(port, () => {
	console.log(`Advanced scraper server is running on http://localhost:${port}`);
});

const shutdown = () => {
	server.close((err) => {
		console.log('Shutting down the server...');
		if (err) {
			console.error('Error during server shutdown:', err);
			process.exitCode = 1;
		}
		process.exit();
	});
};

// quit on ctrl-c when running docker in terminal
process.on('SIGINT', function onSigint() {
	console.info(
		'Got SIGINT (aka ctrl-c in docker). Graceful shutdown ',
		new Date().toISOString(),
	);
	shutdown();
});

// quit properly on docker stop
process.on('SIGTERM', function onSigterm() {
	console.info(
		'Got SIGTERM (docker container stop). Graceful shutdown ',
		new Date().toISOString(),
	);
	shutdown();
});
