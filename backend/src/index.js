import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pkg;

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const app = express();
// Allow configurable origin for production (set ALLOWED_ORIGIN to your frontend URL)
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: allowedOrigin }));
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
    // Ensure users table exists so availability checks don't fail on a fresh DB
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    const result = await pool.query('SELECT 1 FROM users WHERE username = $1 LIMIT 1', [username]);
    return res.json({ exists: result.rowCount > 0 });
  } catch (err) {
    console.error('check-username error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Ensure users table exists and has role column
async function ensureUsersTable(){
  try{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'User',
        admin_expires TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // ensure role column exists for older DBs
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'User'");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_expires TIMESTAMP NULL");
  }catch(err){ console.error('ensureUsersTable error', err); }
}

// Ensure votes table exists helper
async function ensureVotesTable(){
  try{
    await ensureUsersTable();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (user_id, project_id)
      )
    `);
  }catch(err){ console.error('ensureVotesTable error', err); }
}

// Get vote count for a project
app.get('/votes/:projectId', async (req, res) => {
  const projectId = req.params.projectId;
  if(!projectId) return res.status(400).json({ error: 'Missing projectId' });
  try{
    await ensureVotesTable();
    const result = await pool.query('SELECT COUNT(*)::int AS count FROM votes WHERE project_id = $1', [projectId]);
    return res.json({ projectId, count: result.rows[0].count });
  }catch(err){ console.error('get votes error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Check whether a given username has voted for a project
app.get('/votes/:projectId/check', async (req, res) => {
  const projectId = req.params.projectId;
  const username = req.query.username;
  if(!projectId || !username) return res.status(400).json({ error: 'Missing projectId or username' });
  try{
    await ensureVotesTable();
    const userRes = await pool.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [username]);
    if(userRes.rowCount === 0) return res.json({ hasVoted: false });
    const userId = userRes.rows[0].id;
    const v = await pool.query('SELECT 1 FROM votes WHERE user_id = $1 AND project_id = $2 LIMIT 1', [userId, projectId]);
    return res.json({ hasVoted: v.rowCount > 0 });
  }catch(err){ console.error('check vote error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Cast a vote (one vote per user per project). Body: { username, projectId }
app.post('/vote', async (req, res) => {
  const { username, projectId } = req.body || {};
  console.log('/vote called', { username, projectId });
  if(!username || !projectId) {
    console.warn('/vote missing fields', { body: req.body });
    return res.status(400).json({ error: 'Missing username or projectId' });
  }
  if(typeof username !== 'string' || typeof projectId !== 'string'){
    console.warn('/vote invalid types', { body: req.body });
    return res.status(400).json({ error: 'Invalid payload' });
  }
  try{
    await ensureVotesTable();
    // find user
    const userRes = await pool.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [username]);
    if(userRes.rowCount === 0) {
      console.warn('/vote user not found', username);
      return res.status(404).json({ error: 'User not found' });
    }
    const userId = userRes.rows[0].id;
    try{
      const insert = await pool.query('INSERT INTO votes (user_id, project_id) VALUES ($1, $2) RETURNING id, project_id, created_at', [userId, projectId]);
    }catch(dbErr){
      console.error('/vote insert error', dbErr && dbErr.code ? dbErr.code : dbErr);
      if(dbErr && dbErr.code === '23505') return res.status(409).json({ error: 'Already voted' });
      throw dbErr;
    }
    // return new count
    const countRes = await pool.query('SELECT COUNT(*)::int AS count FROM votes WHERE project_id = $1', [projectId]);
    return res.json({ voted: true, projectId, count: countRes.rows[0].count });
  }catch(err){
    console.error('vote error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Remove a vote. Body: { username, projectId }
app.delete('/vote', async (req, res) => {
  const { username, projectId } = req.body || {};
  console.log('DELETE /vote called', { username, projectId });
  if(!username || !projectId){
    console.warn('DELETE /vote missing fields', { body: req.body });
    return res.status(400).json({ error: 'Missing username or projectId' });
  }
  try{
    await ensureVotesTable();
    const userRes = await pool.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [username]);
    if(userRes.rowCount === 0) {
      console.warn('DELETE /vote user not found', username);
      return res.status(404).json({ error: 'User not found' });
    }
    const userId = userRes.rows[0].id;
    const del = await pool.query('DELETE FROM votes WHERE user_id = $1 AND project_id = $2', [userId, projectId]);
    const countRes = await pool.query('SELECT COUNT(*)::int AS count FROM votes WHERE project_id = $1', [projectId]);
    return res.json({ removed: del.rowCount > 0, projectId, count: countRes.rows[0].count });
  }catch(err){ console.error('remove vote error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Remove a vote via POST (compatibility for clients/proxies that strip DELETE bodies)
app.post('/vote/remove', async (req, res) => {
  const { username, projectId } = req.body || {};
  console.log('POST /vote/remove called', { username, projectId });
  if(!username || !projectId){
    console.warn('POST /vote/remove missing fields', { body: req.body });
    return res.status(400).json({ error: 'Missing username or projectId' });
  }
  try{
    await ensureVotesTable();
    const userRes = await pool.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [username]);
    if(userRes.rowCount === 0) {
      console.warn('POST /vote/remove user not found', username);
      return res.status(404).json({ error: 'User not found' });
    }
    const userId = userRes.rows[0].id;
    const del = await pool.query('DELETE FROM votes WHERE user_id = $1 AND project_id = $2', [userId, projectId]);
    const countRes = await pool.query('SELECT COUNT(*)::int AS count FROM votes WHERE project_id = $1', [projectId]);
    return res.json({ removed: del.rowCount > 0, projectId, count: countRes.rows[0].count });
  }catch(err){ console.error('post remove vote error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Debug status: return vote counts per project (read-only)
app.get('/debug/status', async (req, res) => {
  try{
    await ensureVotesTable();
    const rows = await pool.query('SELECT project_id, COUNT(*)::int AS count FROM votes GROUP BY project_id');
    const recent = await pool.query('SELECT v.id, u.username, v.project_id, v.created_at FROM votes v JOIN users u ON u.id = v.user_id ORDER BY v.created_at DESC LIMIT 20');
    return res.json({ counts: rows.rows, recent: recent.rows });
  }catch(err){ console.error('debug status error', err); return res.status(500).json({ error: 'Server error' }); }
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

    const hashed = bcrypt.hashSync(password, 10);
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
    const match = bcrypt.compareSync(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    return res.json({ message: 'Login successful', user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend listening on port ${PORT}`));

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception', err);
  // keep process running for Render to capture logs; optionally exit
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection', reason);
});
