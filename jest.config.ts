import type { Config } from 'jest';

const config: Config = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/tests'],
	testMatch: ['**/*.test.ts'],
	coverageDirectory: 'coverage',
	collectCoverageFrom: ['src/**/*.ts', '!src/types/**'],
	testTimeout: 10000,
	clearMocks: true,
	resetMocks: true,
	restoreMocks: true,
	transformIgnorePatterns: ['node_modules/(?!(jsdom|parse5)/)'],
	moduleNameMapper: {
		'^(\\.{1,2}/.*)\\.js$': '$1',
	},
	transform: {
		'^.+\\.tsx?$': [
			'ts-jest',
			{
				diagnostics: {
					ignoreDiagnostics: [151002],
				},
			},
		],
	},
};

export default config;
