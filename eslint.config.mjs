import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	prettierConfig,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'tests/unit/*.test.ts',
						'tests/integration/*.test.ts',
						'tests/functional/*.test.ts',
					],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// Allow numbers and booleans in template literals — safe and idiomatic
			'@typescript-eslint/restrict-template-expressions': [
				'error',
				{ allowNumber: true, allowBoolean: true },
			],
			// Allow non-null assertions where the developer knows the value exists
			'@typescript-eslint/no-non-null-assertion': 'warn',
		},
	},
	// Relaxed rules for test files
	{
		files: ['tests/**/*.test.ts'],
		rules: {
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-require-imports': 'off',
			'@typescript-eslint/require-await': 'off',
			'@typescript-eslint/no-unnecessary-condition': 'off',
			'@typescript-eslint/no-confusing-void-expression': 'off',
			'@typescript-eslint/await-thenable': 'off',
			'@typescript-eslint/unbound-method': 'off',
		},
	},
	{
		ignores: [
			'dist/',
			'coverage/',
			'node_modules/',
			'jest.config.ts',
			'eslint.config.mjs',
		],
	},
);
