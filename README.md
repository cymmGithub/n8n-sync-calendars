# Sync Calendars

Bidirectional calendar synchronization between two tire service platforms — when there's no API, you build one.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?logo=playwright&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
![n8n](https://img.shields.io/badge/n8n-EA4B71?logo=n8n&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white)

---

## How It Works

<table>
<tr>
<td align="center"><strong>WO → n8n → Oponeo</strong></td>
<td align="center"><strong>Oponeo → n8n → WO</strong></td>
</tr>
<tr>
<td><img src=".github/wo-n8n-oponeo.png" alt="WO to Oponeo sync flow" width="100%"></td>
<td><img src=".github/oponeo-n8n-wo.png" alt="Oponeo to WO sync flow" width="100%"></td>
</tr>
</table>

## The Problem

A tire service client uses two booking platforms simultaneously — **Oponeo** and **Wymiana Opon (WO)**. Bookings on one platform need to appear on the other to prevent double-bookings, conflicts, and missed appointments. WO has a REST API. Oponeo has none — just a web interface behind authentication.

## The Solution

A TypeScript service that acts as an API layer for the API-less platform, combined with n8n workflow orchestration for bidirectional sync:

- **Browser automation** (Playwright + stealth plugins) extracts reservation data from Oponeo's web interface, navigating authentication, pagination, and dynamic content
- **Rotating proxy infrastructure** distributes requests across multiple IP pools with per-account isolation, preventing detection during hourly scraping cycles
- **n8n workflows** orchestrate the full sync pipeline — polling both platforms, diffing calendars, creating/cancelling reservations, and triggering conflict alerts
- **Smart conflict detection** sends Slack messages and email notifications when overlapping bookings are found or out-of-hours appointments are made

## Key Features

- **Bidirectional sync** — Oponeo ↔ WO, reservations flow both directions
- **Conflict detection & alerts** — Slack + email notifications for overlapping bookings
- **Out-of-hours alerts** — flags appointments booked outside business hours
- **Proxy rotation** — multi-account IP management with blacklisting and usage-balanced selection
- **Browser session pooling** — reuses authenticated sessions with idle timeout cleanup
- **Redis-backed deduplication** — prevents duplicate reservation creation across sync cycles

## Tech Stack

| Category | Technology |
|---|---|
| Language | TypeScript, Node.js |
| Browser Automation | Playwright, playwright-extra, stealth plugin |
| Orchestration | n8n (workflow automation) |
| Cache / Dedup | Redis |
| HTTP Server | Express |
| Validation | Zod |
| Logging | Winston |
| Date Handling | date-fns |
| Containerization | Docker (multi-stage build, tini init) |

## Architecture

```mermaid
graph TD
    Oponeo["🌐 Oponeo<br/><small>web UI · no API</small>"]
    n8n["⚙️ n8n<br/><small>workflow orchestration</small>"]
    WO["📡 Wymiana Opon<br/><small>REST API</small>"]

    subgraph service ["sync-calendars service"]
        Scraper["Oponeo Scraper<br/><small>Playwright + stealth</small>"]
        ProxyMgr["Proxy Manager<br/><small>multi-account rotation</small>"]
        WORouter["WO Events Router"]
        BrowserPool["Browser Pool<br/><small>session reuse</small>"]
    end

    Redis["Redis<br/><small>deduplication</small>"]
    Alerts["Slack / Email<br/><small>conflict alerts</small>"]
    Proxies["Webshare<br/><small>proxy IPs</small>"]

    n8n <-->|HTTP| service
    Scraper -->|"browser automation"| Oponeo
    WORouter -->|REST API| WO
    ProxyMgr -->|fetch IP pools| Proxies
    Scraper --> BrowserPool
    Scraper --> ProxyMgr
    service --> Redis
    n8n --> Alerts
```

## Getting Started

```bash
# Clone and configure
git clone <repo-url>
cp .env.example .env  # fill in credentials

# Run with Docker
docker build -t sync-calendars .
docker run -p 3001:3001 --env-file .env sync-calendars
```

The service exposes endpoints consumed by n8n workflows:
- `POST /oponeo/scraper` — scrape and return Oponeo reservations
- `POST /oponeo/mutator` — create reservations on Oponeo
- `POST /oponeo/obliterator` — cancel reservations on Oponeo
- `GET /wo/events` — proxy WO API events with date filtering
- `GET /health` — health check
