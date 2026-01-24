# Local Development Setup

This guide helps you set up PostgreSQL for local development to mirror the production architecture.

## Quick Start

1. **Start PostgreSQL:**
   ```bash
   npm run db:start
   ```

2. **Initialize the database schema:**
   ```bash
   npx tsx scripts/init-local-postgres.ts
   ```

3. **Configure `.env.local`:**
   ```env
   LOCAL_DATABASE_URL=postgresql://code_intel_user:local_dev_password@localhost:5433/code_intel
   ```

4. **Run the app:**
   ```bash
   npm run dev
   ```

## Database Configuration

### Connection Details

The Docker Compose setup provides:
- **Host:** `localhost`
- **Port:** `5433` (to avoid conflicts with system PostgreSQL)
- **Database:** `code_intel`
- **User:** `code_intel_user`
- **Password:** `local_dev_password`

### Environment Variables

The app uses the following priority for database selection:

1. **`LOCAL_DATABASE_URL`** - Used for local development (default)
2. **`DATABASE_URL`** - Used if `LOCAL_DATABASE_URL` is not set (production)
3. **SQLite** - Fallback if neither PostgreSQL URL is set (legacy, not recommended)

### Using Local Database for Batch Scripts

Batch scripts automatically use `LOCAL_DATABASE_URL` when available. To explicitly use the local database:

```bash
USE_LOCAL_DB=true npx tsx scripts/your-script.ts
```

## Database Management

### Stop PostgreSQL
```bash
npm run db:stop
```

### View Database Logs
```bash
docker-compose logs -f postgres
```

### Connect with psql
```bash
psql postgresql://code_intel_user:local_dev_password@localhost:5433/code_intel
```

### Reset Database (⚠️ Destroys all data)
```bash
npm run db:stop
docker volume rm code-intel-digest_postgres_data
npm run db:start
npx tsx scripts/init-local-postgres.ts
```

## Syncing with Production

### Sync from Production to Local
```bash
npm run db:sync:from-prod
```

This requires `PRODUCTION_DATABASE_URL` or `DATABASE_URL` to be set in `.env.local`.

### Sync from Local to Production
```bash
npm run db:sync:to-prod
```

⚠️ **Warning:** This will overwrite production data. Use with caution.

## Troubleshooting

### Port Already in Use

If port 5433 is already in use, you can:
1. Change the port in `docker-compose.yml`
2. Update `LOCAL_DATABASE_URL` in `.env.local` to match

### Connection Refused

Make sure PostgreSQL is running:
```bash
docker-compose ps
```

If not running, start it:
```bash
npm run db:start
```

### Schema Not Initialized

If you see "relation does not exist" errors:
```bash
npx tsx scripts/init-local-postgres.ts
```

### Still Using SQLite

Check that `LOCAL_DATABASE_URL` is set correctly in `.env.local`:
```bash
cat .env.local | grep LOCAL_DATABASE_URL
```

The connection string should start with `postgresql://`.
