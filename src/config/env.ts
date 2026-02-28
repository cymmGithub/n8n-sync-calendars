import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
	PORT: z.coerce.number().default(3001),
	OPONEO_BASE_URL: z.string().url(),
	OPONEO_LOGIN_URL: z.string().url(),
	OPONEO_RESERVATIONS_LIST_URL: z.string().url(),
	OPONEO_EMAIL: z.string().min(1),
	OPONEO_PASSWORD: z.string().min(1),
	WO_API_KEY: z.string().optional(),
	PROXY_BLACKLIST: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

export function extractWebshareAccounts(): Map<number, string> {
	const accounts = new Map<number, string>();
	let accountNum = 1;

	while (process.env[`WEBSHARE_ACCOUNT_${accountNum.toString()}`]) {
		accounts.set(
			accountNum,
			process.env[`WEBSHARE_ACCOUNT_${accountNum.toString()}`] as string,
		);
		accountNum++;
	}

	return accounts;
}

export const webshareAccounts = extractWebshareAccounts();
