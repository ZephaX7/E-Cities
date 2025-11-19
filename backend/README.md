# E-Cities Backend

Simple Node.js backend for the E-Cities project.

Requirements
- Node.js (>= 16)
- PostgreSQL accessible via the provided `DATABASE_URL` in `.env`

Setup
1. Open terminal in `backend` folder
2. Install dependencies:

```powershell
npm install
```

3. Start server:

```powershell
npm start
```

Dev
```powershell
npm run dev
```

Routes
- GET /testdb -> returns result of `SELECT NOW()` from Postgres
- POST /register { email, password } -> creates user (password hashed with bcrypt)
- POST /login { email, password } -> verifies credentials

Notes
- DB connection uses `process.env.DATABASE_URL` and enables SSL with `rejectUnauthorized: false` as requested.
- The server listens on port 3000.
