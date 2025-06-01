// backend/server.js
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// PostgreSQL Pool with SSL for Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ======================
// AUTO-TABLE CREATION
// ======================
async function initializeDatabase() {
  try {
    // Create tables if they don't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS registered_faces (
        name VARCHAR(255) PRIMARY KEY,
        descriptor JSONB NOT NULL,
        timestamp TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance_records (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        distance FLOAT,
        CONSTRAINT fk_name FOREIGN KEY(name) REFERENCES registered_faces(name) ON DELETE CASCADE
      )
    `);

    // Add indexes for performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_attendance_timestamp 
      ON attendance_records (timestamp DESC)
    `);

    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    process.exit(1); // Exit if tables can't be created
  }
}

// ======================
// API ENDPOINTS
// ======================
app.post('/api/register-face', async (req, res) => {
  const { name, descriptor } = req.body;

  if (!name || !descriptor || !Array.isArray(descriptor)) {
    return res.status(400).json({ error: 'Invalid face data' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO registered_faces (name, descriptor)
       VALUES ($1, $2)
       ON CONFLICT (name) 
       DO UPDATE SET descriptor = $2, timestamp = NOW()
       RETURNING *`,
      [name, JSON.stringify(descriptor)]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error registering face:', error);
    res.status(500).json({ error: 'Database operation failed' });
  }
});

app.get('/api/registered-faces', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM registered_faces');
    const faces = rows.map(row => ({
      ...row,
      descriptor: typeof row.descriptor === 'string' ? 
        JSON.parse(row.descriptor) : row.descriptor
    }));
    res.json(faces);
  } catch (error) {
    console.error('Error fetching faces:', error);
    res.status(500).json({ error: 'Database operation failed' });
  }
});

app.post('/api/mark-attendance', async (req, res) => {
  const { name, distance } = req.body;
  
  if (!name || distance === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO attendance_records (name, distance)
       VALUES ($1, $2)
       RETURNING *`,
      [name, distance]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error marking attendance:', error);
    res.status(500).json({ error: 'Database operation failed' });
  }
});

app.get('/api/attendance-log', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM attendance_records 
      ORDER BY timestamp DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ error: 'Database operation failed' });
  }
});

// ======================
// START SERVER
// ======================
async function startServer() {
  await initializeDatabase(); // Ensure tables exist
  
  app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`🔗 PostgreSQL connected to: ${process.env.DATABASE_URL.split('@')[1]}`);
  });
}

startServer().catch(err => {
  console.error('🔥 Failed to start server:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  pool.end(() => {
    console.log('🛑 Pool closed');
    process.exit(0);
  });
});
