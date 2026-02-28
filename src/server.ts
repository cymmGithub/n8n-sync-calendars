import express from 'express';
import { env } from './config/env.js';
import scraperRoutes from './routes/oponeo-scraper.js';
import eventsRoutes from './routes/wo-events.js';

const app = express();

app.use(express.json());

app.use('/oponeo', scraperRoutes);
app.use('/wo', eventsRoutes);

// Health check endpoint
app.get('/health', (_req, res) => {
	res.json({
		status: 'ok',
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
	});
});

const server = app.listen(env.PORT, () => {
	console.log(`Scraper is running on http://localhost:${env.PORT.toString()}`);
});

const shutdown = (): void => {
	server.close((err) => {
		if (err) {
			console.error('Error during server shutdown:', err);
			process.exitCode = 1;
		}
		process.exit();
	});

	// Force exit if graceful shutdown takes too long
	setTimeout(() => {
		console.error('Forced shutdown after timeout');
		process.exit(1);
	}, 5000).unref();
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
