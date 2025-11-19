import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
import bcrypt from 'bcrypt';

const { Pool } = pkg;

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const app = express();
app.use(cors());
app.use(express.json());

// Health / test DB route
app.get('/testdb', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('testdb error', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Check username availability
app.get('/check-username', async (req, res) => {
  const username = req.query.username;
  if (!username) return res.status(400).json({ error: 'Missing username' });
  try {
    const result = await pool.query('SELECT 1 FROM users WHERE username = $1 LIMIT 1', [username]);
    return res.json({ exists: result.rowCount > 0 });
  } catch (err) {
    console.error('check-username error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Register route (username + password)
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });

  try {
    // Ensure users table exists (with username)
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    const hashed = await bcrypt.hash(password, 10);
    const insert = await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username, created_at',
      [username, hashed]
    );

    return res.json({ user: insert.rows[0] });
  } catch (err) {
    console.error('register error', err);
    // 23505 unique_violation
    if (err.code === '23505') return res.status(409).json({ error: 'Username already registered' });
    return res.status(500).json({ error: 'Server error' });
  }
});

// Login route (username + password)
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });

  try {
    const result = await pool.query('SELECT id, username, password FROM users WHERE username = $1', [username]);
    if (result.rowCount === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    return res.json({ message: 'Login successful', user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
