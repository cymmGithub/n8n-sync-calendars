module.exports = {
	testEnvironment: 'node',
	coverageDirectory: 'coverage',
	collectCoverageFrom: [
		'**/*.js',
		'!**/node_modules/**',
		'!**/coverage/**',
		'!jest.config.js',
		'!**/tests/**',
	],
	testMatch: ['**/tests/**/*.test.js'],
	verbose: true,
	testTimeout: 10000,
	clearMocks: true,
	resetMocks: true,
	restoreMocks: true,
	transformIgnorePatterns: [
		'node_modules/(?!(jsdom|parse5)/)',
	],
};
