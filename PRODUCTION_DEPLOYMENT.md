# Production Deployment Guide: Saved Items & Digest Items

## How It Works

### Database Storage

The app uses a **shared database** approach:

- **Development**: Uses SQLite (stored in `.data/digest.db`)
- **Production (Render)**: Uses PostgreSQL (via `DATABASE_URL` environment variable)

The database driver is automatically detected based on the presence of `DATABASE_URL`:
- If `DATABASE_URL` is set → PostgreSQL (production)
- Otherwise → SQLite (development)

### Saved Items & Digest Items

Both "Saved Items" and "Digest Items" are stored in the shared database:

- **`saved_items` table**: General bookmark library for any item type
- **`digest_items` table**: Items specifically marked for digest generation

### User Authentication (Google OAuth)

The app uses **NextAuth v5** with **Google OAuth** (`src/auth.ts`). When enabled:

1. **Per-user data** - Saved items, digest items, generated newsletters, and podcast audio are scoped by `user_id` from the session.
2. **Session** - `session?.user?.id` is used for all user-scoped APIs; unauthenticated or legacy access uses a default `legacy` user id.
3. **Config** - Set `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` (or `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) and `AUTH_SECRET`; optionally `AUTH_GOOGLE_HD` or `AUTH_TEST_EMAILS` for testing.

### How It Works in Production (Render)

1. **Database**: Render PostgreSQL database (persistent, shared across all instances)
2. **Storage**: All saved/digest items are stored server-side in PostgreSQL
3. **Access**: Any browser accessing your Render deployment URL will see the same saved/digest items
4. **Persistence**: Data persists even if the Render service restarts

### API Endpoints

- `GET /api/saved-items` - List all saved items
- `POST /api/saved-items` - Add item to saved items
- `DELETE /api/saved-items?itemId=...` - Remove item from saved items

- `GET /api/digest-items` - List all digest items
- `POST /api/digest-items` - Add item to digest items
- `DELETE /api/digest-items?itemId=...` - Remove item from digest items

### Local vs Production

**Local Development:**
- SQLite database in `.data/digest.db`
- Data is local to your machine
- Each developer has their own database

**Production (Render):**
- PostgreSQL database (managed by Render)
- Single shared database for all users
- Data persists across deployments

### Generated Content (Per User)

- **Generated newsletters**: Stored in `generated_newsletters` (per `user_id`). List via `GET /api/generated-newsletters`, get one via `GET /api/generated-newsletters/[id]`, delete via `DELETE /api/generated-newsletters/[id]`.
- **Podcast audio**: Stored in `user_podcast_audio` + `generated_podcast_audio`. List via `GET /api/user-podcast-audio`, delete via `DELETE /api/user-podcast-audio/[id]`.
