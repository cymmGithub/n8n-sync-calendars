import type { Browser, BrowserContext, Page } from 'playwright';

// .NET tick conversion constants
export const TICKS_PER_MILLISECOND = 10_000;
export const EPOCH_TICKS_AT_UNIX_EPOCH = 621_355_968_000_000_000;

// Proxy system
export interface Proxy {
	ip: string;
	port: string;
}

export interface ProxyCredentials {
	username: string;
	password: string;
}

export interface ProxyList {
	proxies: Proxy[];
	credentials: ProxyCredentials | null;
}

export interface ProxyResult {
	server: string;
	username: string;
	password: string;
	account: number;
}

// Browser pool
export interface BrowserContextResult {
	browser: Browser;
	context: BrowserContext;
	page: Page;
	isAuthenticated: boolean;
}

// Oponeo scraping
export interface ReservationListItem {
	reservation_url: string | null;
	reservation_number: string;
}

export interface ReservationDetails {
	reservation_number: string;
	date: string;
	time: string;
	position: string;
	description: string | null;
	client_name: string;
	phone: string;
	registration_number: string;
	email: string;
}

export interface PaginationStats {
	total_pages: number;
	filtered_count: number;
	pages_processed: number;
}

export interface PaginatedReservations {
	reservations: ReservationListItem[];
	stats: PaginationStats;
}

// Route request/response types
export interface MutatorReservation {
	startDate: number | bigint;
	endDate: number | bigint;
	licencePlate?: string;
	phoneNumber?: string;
}

export interface MutatorResult {
	index: number;
	success: boolean;
	reservation: MutatorReservation;
	reservationId?: string;
	message: string;
	licencePlate: string;
	phoneNumber: string;
	startTime: string;
	endTime: string;
	error?: string;
	timestamp?: string;
}

export interface ObliteratorResult {
	index: number;
	success: boolean;
	oponeoReservationId: string;
	message?: string;
	error?: string;
	timestamp: string;
}

export interface OperationSummary {
	total: number;
	successful: number;
	failed: number;
	success_rate: string;
}
