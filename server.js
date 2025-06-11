require('dotenv').config();
const express = require('express');

// Import route modules
const scraper_routes = require('./routes/oponeo-scraper');
const events_routes = require('./routes/wo-events');

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());

// Use route modules
app.use('/oponeo', scraper_routes);
app.use('/wo', events_routes);

// Health check endpoint
app.get('/health', (req, res) => {
	res.json({
		status: 'ok',
		timestamp: new Date().toISOString(),
		uptime: process.uptime()
	});
});

const server = app.listen(port, () => {
	console.log(`Scraper is running on http://localhost:${port}`);
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
