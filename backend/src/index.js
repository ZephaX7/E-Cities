import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';

const { Pool } = pkg;

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// In-memory temp ban map for chatbot (key -> timestamp ms)
const chatBanMap = new Map();

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
    // profile fields
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT");
  }catch(err){ console.error('ensureUsersTable error', err); }
}

// Ensure tickets table exists helper
async function ensureTicketsTable(){
  try{
    await ensureUsersTable();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        sender_username TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
  }catch(err){ console.error('ensureTicketsTable error', err); }
}

// Ensure ticket replies table exists helper
async function ensureTicketRepliesTable(){
  try{
    await ensureTicketsTable();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ticket_replies (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
        admin_username TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query("ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE");
    await pool.query("ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS sender_username TEXT");
    await pool.query("ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS sender_role TEXT DEFAULT 'Admin'");
    await pool.query("ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS user_deleted BOOLEAN DEFAULT FALSE");
    await pool.query("ALTER TABLE ticket_replies ALTER COLUMN admin_username DROP NOT NULL");
  }catch(err){ console.error('ensureTicketRepliesTable error', err); }
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

// Ensure projects table exists helper
async function ensureProjectsTable(){
  try{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        end_date DATE,
        image_url TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
  }catch(err){ console.error('ensureProjectsTable error', err); }
}

async function isAdminUser(username){
  if(!username) return false;
  try{
    await ensureUsersTable();
    const u = await pool.query('SELECT role, admin_expires FROM users WHERE username = $1 LIMIT 1', [username]);
    if(u.rowCount === 0) return false;
    const row = u.rows[0];
    return row.role === 'Admin' || (row.admin_expires && new Date(row.admin_expires) > new Date());
  }catch(err){ console.error('isAdminUser error', err); return false; }
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

// Projects CRUD
// List projects with vote counts
app.get('/projects', async (req, res) => {
  try{
    await ensureProjectsTable();
    await ensureVotesTable();
    const rows = await pool.query(`
      SELECT p.slug, p.title, COALESCE(p.description,'') AS description,
             p.end_date, p.image_url, p.is_active,
             COALESCE(v.cnt, 0)::int AS votes
      FROM projects p
      LEFT JOIN (
        SELECT project_id AS slug, COUNT(*) AS cnt
        FROM votes
        GROUP BY project_id
      ) v ON v.slug = p.slug
      WHERE p.is_active = TRUE
      ORDER BY p.created_at DESC
    `);
    return res.json({ projects: rows.rows });
  }catch(err){ console.error('list projects error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Admin: create project
app.post('/projects', async (req, res) => {
  const { username, slug, title, description, end_date, image_url, is_active } = req.body || {};
  if(!username) return res.status(400).json({ error: 'Missing username' });
  if(!slug || !title) return res.status(400).json({ error: 'Missing slug or title' });
  try{
    if(!await isAdminUser(username)) return res.status(403).json({ error: 'Forbidden' });
    await ensureProjectsTable();
    const cleanEnd = end_date && String(end_date).trim() !== '' ? end_date : null;
    const cleanImg = image_url && String(image_url).trim() !== '' ? image_url : null;
    const insert = await pool.query(
      `INSERT INTO projects (slug, title, description, end_date, image_url, is_active)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6, TRUE))
       RETURNING slug, title, description, end_date, image_url, is_active, created_at, updated_at`,
      [slug, title, description || null, cleanEnd, cleanImg, typeof is_active === 'boolean' ? is_active : true]
    );
    return res.json({ project: insert.rows[0], created: true });
  }catch(err){
    console.error('create project error', err);
    if(err && err.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
    return res.status(500).json({ error: 'Server error' });
  }
});

// Admin: update project by slug
app.put('/projects/:slug', async (req, res) => {
  const slug = req.params.slug;
  const { username, title, description, end_date, image_url, is_active } = req.body || {};
  if(!username) return res.status(400).json({ error: 'Missing username' });
  try{
    if(!await isAdminUser(username)) return res.status(403).json({ error: 'Forbidden' });
    await ensureProjectsTable();
    const cleanEnd = end_date && String(end_date).trim() !== '' ? end_date : null;
    const cleanImg = image_url && String(image_url).trim() !== '' ? image_url : null;
    const result = await pool.query(
      `UPDATE projects SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        end_date = COALESCE($3, end_date),
        image_url = COALESCE($4, image_url),
        is_active = COALESCE($5, is_active),
        updated_at = NOW()
       WHERE slug = $6
       RETURNING slug, title, description, end_date, image_url, is_active, created_at, updated_at`,
      [title || null, description || null, cleanEnd, cleanImg, (typeof is_active === 'boolean') ? is_active : null, slug]
    );
    if(result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    return res.json({ project: result.rows[0], updated: true });
  }catch(err){ console.error('update project error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Admin: delete project by slug (and related votes)
app.delete('/projects/:slug', async (req, res) => {
  const slug = req.params.slug;
  const { username } = req.body || {};
  if(!username) return res.status(400).json({ error: 'Missing username' });
  try{
    if(!await isAdminUser(username)) return res.status(403).json({ error: 'Forbidden' });
    await ensureProjectsTable();
    await ensureVotesTable();
    // remove votes first to keep data consistent
    await pool.query('DELETE FROM votes WHERE project_id = $1', [slug]);
    const del = await pool.query('DELETE FROM projects WHERE slug = $1', [slug]);
    return res.json({ deleted: del.rowCount > 0 });
  }catch(err){ console.error('delete project error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Tickets endpoints
// Create ticket: POST { username, title, content }
app.post('/tickets', async (req, res) => {
  const { username, title, content } = req.body || {};
  if(!username || !title || !content) return res.status(400).json({ error: 'Missing fields' });
  try{
    await ensureTicketsTable();
    // verify sender exists
    const userRes = await pool.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [username]);
    if(userRes.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    const insert = await pool.query('INSERT INTO tickets (title, content, sender_username) VALUES ($1, $2, $3) RETURNING id, title, content, sender_username, status, created_at', [title, content, username]);
    return res.json({ ticket: insert.rows[0] });
  }catch(err){ console.error('create ticket error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Admin: list tickets. Query param: username (admin)
app.get('/tickets', async (req, res) => {
  const adminUser = req.query.username;
  if(!adminUser) return res.status(400).json({ error: 'Missing username' });
  try{
    await ensureTicketsTable();
    const u = await pool.query('SELECT role, admin_expires FROM users WHERE username = $1 LIMIT 1', [adminUser]);
    if(u.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
    const userRow = u.rows[0];
    const isAdmin = userRow.role === 'Admin' || (userRow.admin_expires && new Date(userRow.admin_expires) > new Date());
    if(!isAdmin) return res.status(403).json({ error: 'Forbidden' });
    const rows = await pool.query(`
      SELECT t.id, t.title, t.sender_username, t.status, t.created_at,
             EXISTS (
               SELECT 1 FROM ticket_replies r
               WHERE r.ticket_id = t.id AND COALESCE(r.sender_role, 'Admin') = 'User' AND r.user_deleted = FALSE
             ) AS has_user_reply
      FROM tickets t
      ORDER BY t.created_at DESC
    `);
    return res.json({ tickets: rows.rows });
  }catch(err){ console.error('list tickets error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Admin: get ticket details
app.get('/tickets/:id', async (req, res) => {
  const adminUser = req.query.username;
  const id = req.params.id;
  if(!adminUser) return res.status(400).json({ error: 'Missing username' });
  try{
    await ensureTicketsTable();
    await ensureTicketRepliesTable();
    const u = await pool.query('SELECT role, admin_expires FROM users WHERE username = $1 LIMIT 1', [adminUser]);
    if(u.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
    const userRow = u.rows[0];
    const isAdmin = userRow.role === 'Admin' || (userRow.admin_expires && new Date(userRow.admin_expires) > new Date());
    if(!isAdmin) return res.status(403).json({ error: 'Forbidden' });
    const t = await pool.query('SELECT * FROM tickets WHERE id = $1 LIMIT 1', [id]);
    if(t.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const replies = await pool.query('SELECT id, ticket_id, admin_username, sender_username, sender_role, message, is_read, user_deleted, created_at FROM ticket_replies WHERE ticket_id = $1 ORDER BY created_at ASC', [id]);
    return res.json({ ticket: t.rows[0], replies: replies.rows });
  }catch(err){ console.error('get ticket error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Admin: reply to a ticket
app.post('/tickets/:id/replies', async (req, res) => {
  const username = req.body && req.body.username;
  const message = (req.body && req.body.message) || '';
  const id = req.params.id;
  if(!username || !message.trim()) return res.status(400).json({ error: 'Missing username or message' });
  try{
    await ensureTicketRepliesTable();
    // ensure ticket exists
    const t = await pool.query('SELECT id, sender_username FROM tickets WHERE id = $1 LIMIT 1', [id]);
    if(t.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const ticketSender = t.rows[0].sender_username;

    // find caller role
    const u = await pool.query('SELECT role, admin_expires FROM users WHERE username = $1 LIMIT 1', [username]);
    if(u.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
    const userRow = u.rows[0];
    const isAdmin = userRow.role === 'Admin' || (userRow.admin_expires && new Date(userRow.admin_expires) > new Date());
    const isOwner = ticketSender === username;

    if(!isAdmin && !isOwner) return res.status(403).json({ error: 'Forbidden' });

    const role = isAdmin ? 'Admin' : 'User';
    const adminUsername = isAdmin ? username : null;
    const insert = await pool.query(
      'INSERT INTO ticket_replies (ticket_id, admin_username, sender_username, sender_role, message, is_read, user_deleted) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, ticket_id, admin_username, sender_username, sender_role, message, is_read, user_deleted, created_at',
      [id, adminUsername, username, role, message, isAdmin ? false : true, false]
    );
    return res.json({ reply: insert.rows[0] });
  }catch(err){ console.error('reply ticket error', err); return res.status(500).json({ error: 'Server error' }); }
});

// User reply shortcut (alias to POST /tickets/:id/replies for clarity)
app.post('/tickets/:id/user-replies', async (req, res) => {
  // Delegate to the main replies endpoint logic by calling the same handler
  req.body = req.body || {};
  // Inject params and call next tick
  req.url = `/tickets/${req.params.id}/replies`;
  req.originalUrl = req.url;
  app._router.handle(req, res, ()=>{});
});

// Admin: delete ticket (compat: POST /tickets/:id/delete and DELETE /tickets/:id)
app.delete('/tickets/:id', async (req, res) => {
  const { username } = req.body || {};
  const id = req.params.id;
  if(!username) return res.status(400).json({ error: 'Missing username' });
  try{
    await ensureTicketsTable();
    const u = await pool.query('SELECT role, admin_expires FROM users WHERE username = $1 LIMIT 1', [username]);
    if(u.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
    const userRow = u.rows[0];
    const isAdmin = userRow.role === 'Admin' || (userRow.admin_expires && new Date(userRow.admin_expires) > new Date());
    if(!isAdmin) return res.status(403).json({ error: 'Forbidden' });
    const d = await pool.query('DELETE FROM tickets WHERE id = $1', [id]);
    return res.json({ deleted: d.rowCount > 0 });
  }catch(err){ console.error('delete ticket error', err); return res.status(500).json({ error: 'Server error' }); }
});

app.post('/tickets/:id/delete', async (req, res) => {
  const { username } = req.body || {};
  const id = req.params.id;
  if(!username) return res.status(400).json({ error: 'Missing username' });
  try{
    await ensureTicketsTable();
    const u = await pool.query('SELECT role, admin_expires FROM users WHERE username = $1 LIMIT 1', [username]);
    if(u.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
    const userRow = u.rows[0];
    const isAdmin = userRow.role === 'Admin' || (userRow.admin_expires && new Date(userRow.admin_expires) > new Date());
    if(!isAdmin) return res.status(403).json({ error: 'Forbidden' });
    const d = await pool.query('DELETE FROM tickets WHERE id = $1', [id]);
    return res.json({ deleted: d.rowCount > 0 });
  }catch(err){ console.error('post delete ticket error', err); return res.status(500).json({ error: 'Server error' }); }
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

// Admin elevation: POST /admin/elevate { username, adminPassword }
// Grants temporary admin (2 hours) if adminPassword matches hardcoded secret
app.post('/admin/elevate', async (req, res) => {
  const { username, adminPassword } = req.body;
  const ADMIN_SECRET = process.env.ADMIN_PASSWORD || 'JgPAey$pP2z1';
  if(!username || !adminPassword) return res.status(400).json({ error: 'Missing username or adminPassword' });
  if(adminPassword !== ADMIN_SECRET) return res.status(403).json({ error: 'Invalid admin password' });
  try{
    await ensureUsersTable();
    const u = await pool.query('SELECT id, username, role, admin_expires FROM users WHERE username = $1 LIMIT 1', [username]);
    if(u.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    const expires = new Date(Date.now() + 2 * 60 * 60 * 1000); // +2 hours
    await pool.query('UPDATE users SET admin_expires = $1 WHERE username = $2', [expires, username]);
    return res.json({ elevated: true, expiresAt: expires.toISOString() });
  }catch(err){ console.error('admin elevate error', err); return res.status(500).json({ error: 'Server error' }); }
});

// User inbox: list replies to their tickets
app.get('/inbox', async (req, res) => {
  const username = req.query.username;
  if(!username) return res.status(400).json({ error: 'Missing username' });
  try{
    await ensureTicketRepliesTable();
    const rows = await pool.query(`
      SELECT r.id, r.ticket_id, t.title AS ticket_title, r.message, r.is_read, r.created_at
      FROM ticket_replies r
      JOIN tickets t ON t.id = r.ticket_id
      WHERE t.sender_username = $1 AND r.user_deleted = FALSE AND COALESCE(r.sender_role, 'Admin') = 'Admin'
      ORDER BY r.created_at DESC
    `, [username]);
    const unreadCount = rows.rows.filter(r => !r.is_read).length;
    return res.json({ replies: rows.rows, unreadCount });
  }catch(err){ console.error('inbox list error', err); return res.status(500).json({ error: 'Server error' }); }
});

// User inbox: mark reply as read
app.post('/inbox/:id/read', async (req, res) => {
  const username = req.body && req.body.username;
  const id = req.params.id;
  if(!username) return res.status(400).json({ error: 'Missing username' });
  try{
    await ensureTicketRepliesTable();
    // Ensure reply belongs to user's ticket
    const owns = await pool.query(`
      SELECT r.id FROM ticket_replies r
      JOIN tickets t ON t.id = r.ticket_id
      WHERE r.id = $1 AND t.sender_username = $2 AND r.user_deleted = FALSE
      LIMIT 1
    `, [id, username]);
    if(owns.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
    await pool.query('UPDATE ticket_replies SET is_read = TRUE WHERE id = $1', [id]);
    return res.json({ updated: true });
  }catch(err){ console.error('inbox read error', err); return res.status(500).json({ error: 'Server error' }); }
});

// User inbox: delete a notification (soft delete for the user)
app.post('/inbox/:id/delete', async (req, res) => {
  const username = req.body && req.body.username;
  const id = req.params.id;
  if(!username) return res.status(400).json({ error: 'Missing username' });
  try{
    await ensureTicketRepliesTable();
    const owns = await pool.query(`
      SELECT r.id FROM ticket_replies r
      JOIN tickets t ON t.id = r.ticket_id
      WHERE r.id = $1 AND t.sender_username = $2 AND r.user_deleted = FALSE
      LIMIT 1
    `, [id, username]);
    if(owns.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
    await pool.query('UPDATE ticket_replies SET user_deleted = TRUE, is_read = TRUE WHERE id = $1', [id]);
    return res.json({ deleted: true });
  }catch(err){ console.error('inbox delete error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Get user profile
app.get('/profile', async (req, res) => {
  const username = req.query.username;
  if(!username) return res.status(400).json({ error: 'Missing username' });
  try{
    await ensureUsersTable();
    const result = await pool.query('SELECT username, role, admin_expires, created_at, first_name, last_name, gender, email FROM users WHERE username = $1 LIMIT 1', [username]);
    if(result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    return res.json({ profile: result.rows[0] });
  }catch(err){ console.error('get profile error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Update user profile
app.post('/profile', async (req, res) => {
  const { username, first_name, last_name, gender, email } = req.body || {};
  if(!username) return res.status(400).json({ error: 'Missing username' });
  try{
    await ensureUsersTable();
    const result = await pool.query(
      'UPDATE users SET first_name = $1, last_name = $2, gender = $3, email = $4 WHERE username = $5 RETURNING username, role, admin_expires, created_at, first_name, last_name, gender, email',
      [first_name || null, last_name || null, gender || null, email || null, username]
    );
    if(result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    return res.json({ profile: result.rows[0], updated: true });
  }catch(err){ console.error('update profile error', err); return res.status(500).json({ error: 'Server error' }); }
});

// User inbox: unread count only
app.get('/inbox/count', async (req, res) => {
  const username = req.query.username;
  if(!username) return res.status(400).json({ error: 'Missing username' });
  try{
    await ensureTicketRepliesTable();
    const rows = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM ticket_replies r
      JOIN tickets t ON t.id = r.ticket_id
      WHERE t.sender_username = $1 AND r.is_read = FALSE AND r.user_deleted = FALSE AND COALESCE(r.sender_role, 'Admin') = 'Admin'
    `, [username]);
    return res.json({ unread: rows.rows[0].count });
  }catch(err){ console.error('inbox count error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Ensure ideas table exists helper
async function ensureIdeasTable(){
  try{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ideas (
        id SERIAL PRIMARY KEY,
        address TEXT NOT NULL,
        content TEXT NOT NULL,
        sender_username TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query("ALTER TABLE ideas ADD COLUMN IF NOT EXISTS sender_username TEXT");
  }catch(err){ console.error('ensureIdeasTable error', err); }
}

// Ensure problems table exists helper
async function ensureProblemsTable(){
  try{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS problems (
        id SERIAL PRIMARY KEY,
        address TEXT NOT NULL,
        content TEXT NOT NULL,
        sender_username TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query("ALTER TABLE problems ADD COLUMN IF NOT EXISTS sender_username TEXT");
  }catch(err){ console.error('ensureProblemsTable error', err); }
}

// Ensure surveys table exists helper
async function ensureSurveysTable(){
  try{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS surveys (
        id SERIAL PRIMARY KEY,
        project_id TEXT NOT NULL,
        question TEXT NOT NULL,
        options TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        created_at TIMESTAMP DEFAULT NOW(),
        ended_at TIMESTAMP NULL
      )
    `);
    await pool.query("ALTER TABLE surveys ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP NULL");
  }catch(err){ console.error('ensureSurveysTable error', err); }
}

// Ensure survey responses table exists helper
async function ensureSurveyResponsesTable(){
  try{
    await ensureSurveysTable();
    await ensureUsersTable();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS survey_responses (
        id SERIAL PRIMARY KEY,
        survey_id INTEGER REFERENCES surveys(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        response TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (survey_id, user_id)
      )
    `);
  }catch(err){ console.error('ensureSurveyResponsesTable error', err); }
}

// Submit an idea
app.post('/ideas', async (req, res) => {
  const { address, content, username } = req.body || {};
  if(!address || !content || !username) return res.status(400).json({ error: 'Missing address, content or username' });
  try{
    await ensureIdeasTable();
    const result = await pool.query(
      'INSERT INTO ideas (address, content, sender_username) VALUES ($1, $2, $3) RETURNING id, created_at',
      [address, content, username]
    );
    return res.status(201).json({ success: true, id: result.rows[0].id, created_at: result.rows[0].created_at });
  }catch(err){
    console.error('POST /ideas error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Submit a problem
app.post('/problems', async (req, res) => {
  const { address, content, username } = req.body || {};
  if(!address || !content || !username) return res.status(400).json({ error: 'Missing address, content or username' });
  try{
    await ensureProblemsTable();
    const result = await pool.query(
      'INSERT INTO problems (address, content, sender_username) VALUES ($1, $2, $3) RETURNING id, created_at',
      [address, content, username]
    );
    return res.status(201).json({ success: true, id: result.rows[0].id, created_at: result.rows[0].created_at });
  }catch(err){
    console.error('POST /problems error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Get all ideas (admin only)
app.get('/ideas', async (req, res) => {
  const username = req.query.username;
  if(!username) return res.status(400).json({ error: 'Missing username' });
  const isAdmin = await isAdminUser(username);
  if(!isAdmin) return res.status(403).json({ error: 'Not authorized' });
  try{
    await ensureIdeasTable();
    const result = await pool.query(
      'SELECT id, address, content, sender_username, created_at FROM ideas ORDER BY created_at DESC'
    );
    return res.json({ ideas: result.rows });
  }catch(err){
    console.error('GET /ideas error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Get all problems (admin only)
app.get('/problems', async (req, res) => {
  const username = req.query.username;
  if(!username) return res.status(400).json({ error: 'Missing username' });
  const isAdmin = await isAdminUser(username);
  if(!isAdmin) return res.status(403).json({ error: 'Not authorized' });
  try{
    await ensureProblemsTable();
    const result = await pool.query(
      'SELECT id, address, content, sender_username, created_at FROM problems ORDER BY created_at DESC'
    );
    return res.json({ problems: result.rows });
  }catch(err){
    console.error('GET /problems error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Delete an idea (admin only)
app.post('/ideas/:id/delete', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { username } = req.body || {};
  if(!username || !id) return res.status(400).json({ error: 'Missing fields' });
  const isAdmin = await isAdminUser(username);
  if(!isAdmin) return res.status(403).json({ error: 'Not authorized' });
  try{
    await ensureIdeasTable();
    const r = await pool.query('DELETE FROM ideas WHERE id = $1', [id]);
    return res.json({ deleted: r.rowCount > 0 });
  }catch(err){ console.error('delete idea error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Delete a problem (admin only)
app.post('/problems/:id/delete', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { username } = req.body || {};
  if(!username || !id) return res.status(400).json({ error: 'Missing fields' });
  const isAdmin = await isAdminUser(username);
  if(!isAdmin) return res.status(403).json({ error: 'Not authorized' });
  try{
    await ensureProblemsTable();
    const r = await pool.query('DELETE FROM problems WHERE id = $1', [id]);
    return res.json({ deleted: r.rowCount > 0 });
  }catch(err){ console.error('delete problem error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Create a survey for a project (admin only)
app.post('/projects/:projectId/survey', async (req, res) => {
  const projectId = req.params.projectId;
  const { question, options, username } = req.body || {};
  if(!projectId || !question || !options || !username) return res.status(400).json({ error: 'Missing fields' });
  const isAdmin = await isAdminUser(username);
  if(!isAdmin) return res.status(403).json({ error: 'Not authorized' });
  try{
    await ensureSurveysTable();
    const optionsStr = JSON.stringify(Array.isArray(options) ? options : []);
    const result = await pool.query('INSERT INTO surveys (project_id, question, options, status) VALUES ($1, $2, $3, $4) RETURNING id, project_id, question, options, status, created_at, ended_at', [projectId, question, optionsStr, 'open']);
    return res.json(result.rows[0]);
  }catch(err){ console.error('create survey error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Get latest survey for a project (open or closed) with aggregated counts
app.get('/projects/:projectId/survey', async (req, res) => {
  const projectId = req.params.projectId;
  if(!projectId) return res.status(400).json({ error: 'Missing projectId' });
  try{
    await ensureSurveysTable();
    await ensureSurveyResponsesTable();
    const result = await pool.query('SELECT id, project_id, question, options, status, created_at, ended_at FROM surveys WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1', [projectId]);
    if(result.rowCount === 0) return res.json(null);
    const survey = result.rows[0];
    survey.options = JSON.parse(survey.options || '[]');

    // Aggregate counts per response
    const countsRes = await pool.query('SELECT response, COUNT(*)::int AS cnt FROM survey_responses WHERE survey_id = $1 GROUP BY response', [survey.id]);
    const countsMap = {};
    countsRes.rows.forEach(r => { countsMap[r.response] = r.cnt; });
    survey.counts = countsMap;
    return res.json(survey);
  }catch(err){ console.error('get survey error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Submit a survey response (authenticated user)
app.post('/survey/:surveyId/response', async (req, res) => {
  const surveyId = parseInt(req.params.surveyId, 10);
  const { userId, response } = req.body || {};
  if(!surveyId || !userId || !response) return res.status(400).json({ error: 'Missing fields' });
  try{
    await ensureSurveyResponsesTable();
    const survey = await pool.query('SELECT status FROM surveys WHERE id = $1', [surveyId]);
    if(survey.rowCount === 0) return res.status(404).json({ error: 'Survey not found' });
    if(survey.rows[0].status !== 'open') return res.status(400).json({ error: 'Survey is closed' });
    const result = await pool.query('INSERT INTO survey_responses (survey_id, user_id, response) VALUES ($1, $2, $3) ON CONFLICT (survey_id, user_id) DO UPDATE SET response = $3 RETURNING id', [surveyId, userId, response]);
    return res.json({ id: result.rows[0].id });
  }catch(err){ console.error('submit survey response error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Get survey responses (admin only)
app.get('/survey/:surveyId/responses', async (req, res) => {
  const surveyId = parseInt(req.params.surveyId, 10);
  const username = req.query.username;
  if(!surveyId || !username) return res.status(400).json({ error: 'Missing fields' });
  const isAdmin = await isAdminUser(username);
  if(!isAdmin) return res.status(403).json({ error: 'Not authorized' });
  try{
    await ensureSurveyResponsesTable();
    const result = await pool.query('SELECT sr.id, sr.user_id, sr.response, sr.created_at, u.username FROM survey_responses sr LEFT JOIN users u ON sr.user_id = u.id WHERE sr.survey_id = $1 ORDER BY sr.created_at DESC', [surveyId]);
    return res.json(result.rows);
  }catch(err){ console.error('get survey responses error', err); return res.status(500).json({ error: 'Server error' }); }
});

// End a survey (admin only) - users can see responses but can't vote
app.post('/survey/:surveyId/end', async (req, res) => {
  const surveyId = parseInt(req.params.surveyId, 10);
  const { username } = req.body || {};
  if(!surveyId || !username) return res.status(400).json({ error: 'Missing fields' });
  const isAdmin = await isAdminUser(username);
  if(!isAdmin) return res.status(403).json({ error: 'Not authorized' });
  try{
    await ensureSurveysTable();
    const result = await pool.query('UPDATE surveys SET status = $1, ended_at = NOW() WHERE id = $2 RETURNING id, status', ['closed', surveyId]);
    return res.json({ ended: result.rowCount > 0 });
  }catch(err){ console.error('end survey error', err); return res.status(500).json({ error: 'Server error' }); }
});

// Delete a survey (admin only)
app.post('/survey/:surveyId/delete', async (req, res) => {
  const surveyId = parseInt(req.params.surveyId, 10);
  const { username } = req.body || {};
  if(!surveyId || !username) return res.status(400).json({ error: 'Missing fields' });
  const isAdmin = await isAdminUser(username);
  if(!isAdmin) return res.status(403).json({ error: 'Not authorized' });
  try{
    await ensureSurveysTable();
    const r = await pool.query('DELETE FROM surveys WHERE id = $1', [surveyId]);
    return res.json({ deleted: r.rowCount > 0 });
  }catch(err){ console.error('delete survey error', err); return res.status(500).json({ error: 'Server error' }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend listening on port ${PORT}`));

// Contact form: send email to configured recipient
app.post('/contact', async (req, res) => {
  const { name, email, message } = req.body || {};
  function isValidEmail(e){
    if(!e) return false;
    const basic = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if(!basic.test(e)) return false;
    if(/test/i.test(e)) return false;
    return true;
  }
  function hasInsults(text){
    if(!text) return false;
    const lower = String(text).toLowerCase();
    const bad = ['connard','connasse','fdp','fils de pute','pute','salope','batard','encule','enfoire','merde','bouffon','naze','abruti','cretin','idiot','con ',' con'];
    return bad.some(w => lower.includes(w));
  }
  if(!name || !email || !message) return res.status(400).json({ error: 'Missing fields' });
  if(!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email' });
  if(hasInsults(name) || hasInsults(message)) return res.status(400).json({ error: 'Insulting content blocked' });

  try{
    const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
    const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
    const SMTP_USER = process.env.SMTP_USER;
    const SMTP_PASS = process.env.SMTP_PASS;
    const TO_EMAIL = process.env.CONTACT_TO || 'ecities5@gmail.com';

    if(!SMTP_USER || !SMTP_PASS){
      console.warn('SMTP not configured; simulating send');
      return res.json({ sent:false, simulated:true });
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    await transporter.sendMail({
      from: `${name} <${email}>`,
      to: TO_EMAIL,
      subject: `Contact E-cities - ${name}`,
      text: `De : ${name} <${email}>\n\nMessage :\n${message}`
    });

    return res.json({ sent:true });
  }catch(err){
    console.error('contact send error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// AI chatbot conversation endpoint
// POST /ai/chat { username?, message, history? }
// If user provides a problem, AI tries to help and ticket is auto-created in background.
app.post('/ai/chat', async (req, res) => {
  const { username, message, history } = req.body || {};
  if(!message || !message.trim()) return res.status(400).json({ error: 'Missing message' });

  const chatKey = (username && username.trim()) || req.ip || 'anon';
  const now = Date.now();

  // Unban if expired
  const existingBan = chatBanMap.get(chatKey);
  if(existingBan && existingBan > now){
    return res.status(429).json({ reply: 'Vous avez été temporairement bloqué pour messages inappropriés. Réessayez dans quelques minutes.', banned: true, retryAt: new Date(existingBan).toISOString() });
  }else if(existingBan){
    chatBanMap.delete(chatKey);
  }

  // Smart ticket collector mode - provides helpful responses without external AI
  function generateSmartReply(userMessage){
    const lower = userMessage.toLowerCase();
    
    // Greetings
    if(/^(bonjour|salut|hello|hi|hey|coucou)[\s!?]*$/i.test(userMessage.trim())){
      return 'Bonjour ! 👋 Je suis l\'assistant E-cities. Comment puis-je vous aider aujourd\'hui ? Vous pouvez me poser des questions sur les projets, les votes, votre compte ou la visualisation 3D.';
    }
    
    // Thanks
    if(/merci|thanks|thank you/i.test(lower)){
      return 'De rien ! N\'hésitez pas si vous avez d\'autres questions. Je suis là pour vous aider ! 😊';
    }
    
    // Project creation
    if(/(comment|how).*(créer|create|faire|make).*(projet|project)/i.test(lower)){
      return '📝 Pour créer un projet :\n1. Cliquez sur "Projets" dans le menu\n2. Cliquez sur "Nouveau projet"\n3. Remplissez le titre et la description\n4. Ajoutez des images si vous le souhaitez\n5. Validez !\n\nVotre projet sera visible par tous les utilisateurs qui pourront voter.';
    }
    
    // Project visibility/status
    if(/projet.*(visible|voir|afficher|apparaît|published)/i.test(lower)){
      return 'Une fois créé, votre projet est immédiatement visible dans la liste des projets. Les autres utilisateurs peuvent le consulter et voter pour soutenir votre idée ! 🎉';
    }
    
    // Voting system
    if(/(comment|how).*(vote|voter)/i.test(lower)){
      return '🗳️ Pour voter pour un projet :\n1. Parcourez la liste des projets\n2. Cliquez sur un projet qui vous intéresse\n3. Cliquez sur le bouton "Voter"\n\nVous pouvez voter pour autant de projets que vous le souhaitez. Vos votes sont enregistrés instantanément !';
    }
    
    // Vote count/results
    if(/combien|nombre|résultat|score|classement/i.test(lower) && /vote/i.test(lower)){
      return 'Le nombre de votes pour chaque projet est affiché directement sur la carte du projet. Les projets les plus populaires apparaissent en tête de liste ! 📊';
    }
    
    // Remove vote
    if(/(retirer|enlever|supprimer|annuler).*(vote)/i.test(lower)){
      return 'Pour retirer votre vote, retournez sur le projet et cliquez à nouveau sur le bouton de vote. Il changera pour indiquer que votre vote a été retiré. ↩️';
    }
    
    // Account/Profile
    if(/(comment|where|où).*(profil|profile|compte|account)/i.test(lower)){
      return '👤 Pour accéder à votre profil :\n• Cliquez sur le bouton "Info" en haut à droite\n\nDans votre profil, vous pouvez :\n• Voir vos informations personnelles\n• Consulter vos tickets\n• Gérer vos paramètres';
    }
    
    // Password/login issues
    if(/(mot de passe|password|connexion|login|connect)/i.test(lower)){
      return '🔐 Problème de connexion ?\n• Vérifiez que votre nom d\'utilisateur et mot de passe sont corrects\n• Les mots de passe sont sensibles à la casse\n\nSi le problème persiste, un administrateur peut vous aider à réinitialiser votre compte.';
    }
    
    // 3D visualization
    if(/3d|visualisation|visualization|carte|map/i.test(lower)){
      return '🗺️ La visualisation 3D vous permet d\'explorer tous les projets sur une carte interactive en 3D !\n\nPour y accéder :\n• Cliquez sur "Visualisation" dans le menu principal\n• Naviguez sur la carte pour découvrir les projets\n• Cliquez sur un projet pour voir ses détails';
    }
    
    // Tickets/Support
    if(/ticket|support/i.test(lower) && !/(créer|create|faire|make)/i.test(lower)){
      return '🎫 Vos tickets :\n• Vous pouvez consulter tous vos tickets depuis votre profil\n• Les administrateurs répondent généralement sous 24-48h\n• Vous serez notifié quand un admin répond à votre ticket';
    }
    
    // Report problem
    if(/(problème|erreur|bug|panne|ne marche pas|ne fonctionne pas|cassé|broken)/i.test(lower)){
      return '⚠️ Je comprends que vous rencontrez un problème. Votre demande a été automatiquement transmise à l\'équipe technique.\n\nUn administrateur analysera votre situation et vous répondra rapidement. En attendant, essayez de :\n• Rafraîchir la page (F5)\n• Vérifier votre connexion internet\n• Essayer un autre navigateur';
    }
    
    // Help/general assistance
    if(/^(aide|help|info)[\s!?]*$/i.test(userMessage.trim())){
      return '💡 Je peux vous aider avec :\n• Création et gestion de projets\n• Système de votes\n• Visualisation 3D\n• Votre compte et profil\n• Résolution de problèmes techniques\n\nPosez-moi simplement votre question !';
    }
    
    // Who are you
    if(/(qui es-tu|qui êtes-vous|who are you|c\'est quoi|what are you)/i.test(lower)){
      return 'Je suis l\'assistant virtuel d\'E-cities ! 🤖\n\nMa mission est de vous aider à utiliser la plateforme et de répondre à vos questions. Si je ne peux pas résoudre votre problème, un administrateur humain prendra le relais !';
    }
    
    // What is E-cities
    if(/(c\'est quoi|what is|qu\'est-ce que).*(e-cities|plateforme|site)/i.test(lower)){
      return 'E-cities est une plateforme collaborative qui permet aux citoyens de :\n• 🏗️ Proposer des projets pour améliorer leur quartier\n• 🗳️ Voter pour les projets qui les intéressent\n• 🗺️ Visualiser tous les projets sur une carte 3D interactive\n\nC\'est un espace où vos idées prennent vie !';
    }
    
    // General conversational fallback
    if(userMessage.trim().length < 10){
      return 'Je ne suis pas sûr de comprendre. Pouvez-vous reformuler votre question ? Je peux vous aider avec les projets, les votes, la visualisation 3D ou votre compte. 🤔';
    }
    
    // Default fallback
    return 'Merci pour votre message ! 📩\n\nVotre demande a été transmise à notre équipe. Un administrateur vous répondra rapidement via ce chat.\n\nEn attendant, n\'hésitez pas à me poser d\'autres questions sur E-cities !';
  }

  // Basic moderation (temp ban 5 minutes)
  const lowerMsg = message.toLowerCase();
  const badWords = /(putain|merde|connard|conne|salope|batard|bâtard|fdp|fils de pute|enculé|encule|nique ta mère|ntm|ta gueule|fuck|shit)/i;
  if(badWords.test(lowerMsg)){
    const until = now + 5 * 60 * 1000;
    chatBanMap.set(chatKey, until);
    return res.status(429).json({ reply: 'Message inapproprié détecté. Le chat est bloqué pendant 5 minutes.', banned: true, retryAt: new Date(until).toISOString() });
  }

  const aiReply = generateSmartReply(message);
  const usedAI = false;
  console.log('[AI] Smart reply mode:', aiReply.slice(0, 60) + '...');

  // Auto-create ticket for ALL messages (smart collector mode)
  let ticketCreated = false;
  let ticketId = null;
  const ticketUser = username || 'chatbot-anon';
  console.log('[AI] Creating ticket for:', { username: ticketUser, messagePreview: lowerMsg.slice(0, 50) });
  
  try{
    await ensureTicketsTable();
    const title = '💬 Chat: ' + message.slice(0,50);
    const content = `💬 Message depuis le chatbot\nUtilisateur: ${ticketUser}\n\nMessage:\n${message}\n\nRéponse automatique:\n${aiReply}`;
    const result = await pool.query('INSERT INTO tickets (title, content, sender_username, status) VALUES ($1, $2, $3, $4) RETURNING id', [title, content, ticketUser, 'open']);
    ticketCreated = true;
    ticketId = result.rows[0].id;
    console.log('[AI] Ticket created with ID:', ticketId);
  }catch(err){
    console.error('[AI] auto-ticket creation error', err);
  }

  return res.json({ reply: aiReply, usedAI, ticketCreated, ticketId });
});

// === ADMIN STATS ENDPOINTS ===
app.get('/admin/stats', async (req, res) => {
  const username = req.query.username;
  if (!username) return res.status(400).json({ error: 'Missing username' });
  
  try {
    // Ensure users table has role column
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'User'
    `);

    // Check if user exists (just verify they're a real user, no role restriction)
    const userCheck = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (userCheck.rowCount === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Ensure tickets table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        sender_username TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Get total users count
    const totalUsers = await pool.query('SELECT COUNT(*) as count FROM users');
    
    // Get users created this month
    const thisMonth = await pool.query(`
      SELECT COUNT(*) as count FROM users 
      WHERE created_at >= DATE_TRUNC('month', NOW())
    `);
    
    // Get users created this week
    const thisWeek = await pool.query(`
      SELECT COUNT(*) as count FROM users 
      WHERE created_at >= DATE_TRUNC('week', NOW())
    `);
    
    // Get open tickets count
    const openTickets = await pool.query(`
      SELECT COUNT(*) as count FROM tickets 
      WHERE status = 'open'
    `);
    
    // Get total tickets count
    const allTickets = await pool.query('SELECT COUNT(*) as count FROM tickets');
    
    // Get tickets created this week
    const ticketsThisWeek = await pool.query(`
      SELECT COUNT(*) as count FROM tickets 
      WHERE created_at >= DATE_TRUNC('week', NOW())
    `);
    
    return res.json({
      stats: {
        totalUsers: parseInt(totalUsers.rows[0].count),
        usersThisMonth: parseInt(thisMonth.rows[0].count),
        usersThisWeek: parseInt(thisWeek.rows[0].count),
        openTickets: parseInt(openTickets.rows[0].count),
        totalTickets: parseInt(allTickets.rows[0].count),
        ticketsThisWeek: parseInt(ticketsThisWeek.rows[0].count)
      }
    });
  } catch (err) {
    console.error('admin stats error', err);
    return res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception', err);
  // keep process running for Render to capture logs; optionally exit
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection', reason);
});
