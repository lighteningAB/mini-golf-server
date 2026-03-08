# Mini Golf Server

Serverless API for the daily mini golf challenge game. Built with
**Hono + Drizzle ORM + Neon Postgres**, designed to deploy on **Vercel**.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment template and fill in values
cp .env.example .env.local

# Generate and run database migrations
npm run db:generate
npm run db:migrate

# Deploy to Vercel
npm run deploy
```

## Environment Variables

| Variable       | Description                                    |
| -------------- | ---------------------------------------------- |
| `POSTGRES_URL` | Neon / Vercel Postgres connection string        |
| `API_KEY`      | Widget API key (comma-separated for rotation)  |
| `CRON_SECRET`  | Vercel cron job authentication secret          |

## API Endpoints

All endpoints require an `x-api-key` header.

| Method | Path                            | Description                        |
| ------ | ------------------------------- | ---------------------------------- |
| GET    | `/challenge/today`              | Fetch today's course               |
| POST   | `/challenge/:id/submit`         | Submit a score                     |
| GET    | `/challenge/:id/leaderboard`    | Daily leaderboard (paginated)      |
| GET    | `/leaderboard/alltime`          | All-time leaderboard               |
| GET    | `/user/:id/stats`               | Player stats                       |
| GET    | `/api/cron/generate-course`     | Daily course generation (cron)     |

## Database

Three tables: `challenges`, `submissions`, `users`. Schema is defined in
`src/db/schema.ts` using Drizzle ORM. Run `npm run db:studio` to browse
data locally.
