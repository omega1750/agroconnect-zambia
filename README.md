# AgroConnect Zambia

A starter structure for the AgroConnect Zambia project, using Express and PostgreSQL.

## Project structure

- `client/` — frontend pages and assets
- `server/app.js` — Express entry point
- `server/db/pool.js` — PostgreSQL connection pool
- `server/routes/auth.routes.js` — registration endpoint
- `database/schema.sql` — database tables

## Setup

1. Install Node.js (LTS) and PostgreSQL.
2. Open a terminal in the `agroconnect-zambia` project root.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Create a PostgreSQL database named `agroconnect_zambia` in pgAdmin.
5. Open Query Tool for that database and run `database/schema.sql`.
6. Copy `.env.example` to `.env`, then enter your own PostgreSQL password.
7. Start the app:

   ```bash
   npm run dev
   ```

8. The API health check is `http://localhost:5000/api/health`.
9. Registration endpoint: `POST http://localhost:5000/api/auth/register`.

## Registration JSON example

```json
{
  "fullName": "Example Farmer",
  "email": "farmer@example.com",
  "phone": "+260 977 000000",
  "location": "Kabwe",
  "role": "farmer",
  "password": "ChangeMe123",
  "confirmPassword": "ChangeMe123"
}
```

Roles supported by the starter backend: `farmer` and `buyer`.

## Important

- `.env` is ignored by Git. Never share or commit your real database password.
- This scaffold does not claim to include your previous frontend files. Merge your existing `login/`, `registration/`, `marketPlace/`, and `database/` frontend assets into the matching folders if you already built them.
- PostgreSQL's `pg` package uses `pool.query(...)`, not MySQL's `pool.execute(...)`.
