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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend listening on port ${PORT}`));

// AI chatbot conversation endpoint
// POST /ai/chat { username?, message, history? }
// If user provides a problem, AI tries to help and ticket is auto-created in background.
app.post('/ai/chat', async (req, res) => {
  const { username, message, history } = req.body || {};
  if(!message || !message.trim()) return res.status(400).json({ error: 'Missing message' });

  const apiKey = process.env.AI_API_KEY;
  const apiUrl = process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions';
  const model = process.env.AI_MODEL || 'gpt-4o-mini';

  function fallbackReply(){
    return 'Je suis actuellement indisponible. Votre demande a été enregistrée et un administrateur vous répondra bientôt.';
  }

  // Build conversation messages
  const messages = [
    { role: 'system', content: 'Tu es l\'assistant E-cities. Aide les utilisateurs avec leurs questions sur la plateforme (projets, votes, tickets, visualisation 3D). Sois concis, amical et en français. Si un problème technique est décrit, confirme que tu le transmets aux admins.' }
  ];
  if(Array.isArray(history)){
    history.forEach(h => {
      if(h.role === 'user' || h.role === 'assistant') messages.push({ role: h.role, content: h.content });
    });
  }
  messages.push({ role: 'user', content: message });

  let aiReply = null;
  let usedAI = false;

  if(apiKey){
    try{
      const aiRes = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 300 })
      });
      if(aiRes.ok){
        const data = await aiRes.json();
        aiReply = data.choices?.[0]?.message?.content || null;
        if(aiReply) usedAI = true;
      } else {
        console.warn('AI API error', aiRes.status, await aiRes.text().catch(()=>''));
      }
    }catch(err){
      console.error('ai chat error', err);
    }
  }

  if(!aiReply) aiReply = fallbackReply();

  // Auto-create ticket if user seems to describe a problem (silent)
  const lowerMsg = message.toLowerCase();
  const seemsProblem = /problème|erreur|bug|panne|ne marche pas|ne fonctionne pas|impossible|bloqué|aide/.test(lowerMsg);
  let ticketCreated = false;
  if(username && seemsProblem){
    try{
      await ensureTicketsTable();
      const title = '🤖 Chatbot: ' + message.slice(0,50);
      const content = `📝 Conversation chatbot\nUtilisateur: ${username}\n\nDemande:\n${message}\n\nRéponse IA:\n${aiReply}`;
      await pool.query('INSERT INTO tickets (title, content, sender_username, status) VALUES ($1, $2, $3, $4)', [title, content, username, 'open']);
      ticketCreated = true;
    }catch(err){
      console.error('auto-ticket creation error', err);
    }
  }

  return res.json({ reply: aiReply, usedAI, ticketCreated });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception', err);
  // keep process running for Render to capture logs; optionally exit
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection', reason);
});
