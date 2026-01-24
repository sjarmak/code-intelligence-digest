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

### Important: No User Authentication

⚠️ **Critical**: The app currently has **no user authentication**. This means:

1. **All users share the same database** - Any item added to "Saved Items" or "Digest Items" by one user will be visible to all users
2. **This is a single-user application** - Designed for personal use, not multi-user
3. **Data is persistent** - Items persist across browser sessions and devices (as long as they access the same Render deployment)

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

### If You Need User-Specific Data

If you want to add user authentication in the future, you would need to:

1. Add a `user_id` column to `saved_items` and `digest_items` tables
2. Modify API endpoints to filter by `user_id`
3. Implement authentication (e.g., NextAuth.js, Clerk, etc.)
4. Update UI to show only the current user's items

For now, the app is designed as a **single-user personal tool**.
