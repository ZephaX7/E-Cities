-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'User',
  admin_expires TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  first_name TEXT,
  last_name TEXT,
  gender TEXT,
  email TEXT
);

-- Projects table
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
);

-- Votes table
CREATE TABLE IF NOT EXISTS votes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, project_id)
);

-- Tickets table
CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  sender_username TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Ticket replies table
CREATE TABLE IF NOT EXISTS ticket_replies (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  admin_username TEXT,
  sender_username TEXT,
  sender_role TEXT DEFAULT 'Admin',
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  user_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_votes_user_id ON votes(user_id);
CREATE INDEX IF NOT EXISTS idx_votes_project_id ON votes(project_id);
CREATE INDEX IF NOT EXISTS idx_tickets_sender_username ON tickets(sender_username);
CREATE INDEX IF NOT EXISTS idx_ticket_replies_ticket_id ON ticket_replies(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_replies_sender_username ON ticket_replies(sender_username);
