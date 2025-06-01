// backend/server.js

const express = require('express');
const { Pool } = require('pg'); // PostgreSQL client
const path = require('path');
const cors = require('cors'); // Required for cross-origin requests from frontend
require('dotenv').config(); // Load environment variables from .env file

const app = express();
const port = 3000; // Backend server port

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(express.json({ limit: '50mb' })); // To parse JSON request bodies, increase limit for descriptors

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for Render
});

// Test connection
pool.connect()
  .then(client => {
    console.log('Connected to PostgreSQL database!');
    client.release();
  })
  .catch(err => {
    console.error('PostgreSQL connection error:', err.message);
  });

// --- API Endpoints ---

// Endpoint to register a new face
app.post('/api/register-face', async (req, res) => {
    const { name, descriptor } = req.body;

    if (!name || !descriptor || !Array.isArray(descriptor)) {
        console.warn('Register Face: Invalid request - missing name or descriptor.');
        return res.status(400).json({ error: 'Name and valid descriptor (array) are required.' });
    }

    try {
        const descriptorJsonString = JSON.stringify(descriptor); // Convert array to JSON string for storage
        const { rowCount } = await pool.query(
            `INSERT INTO registered_faces (name, descriptor, timestamp) 
             VALUES ($1, $2, NOW()) 
             ON CONFLICT (name) 
             DO UPDATE SET descriptor = $2, timestamp = NOW()`,
            [name, descriptorJsonString]
        );
        console.log(`Register Face: Data inserted/updated for "${name}". Affected rows: ${rowCount}`);
        res.status(201).json({ message: 'Face registered successfully!' });
    } catch (error) {
        console.error('Error registering face:', error);
        res.status(500).json({ error: 'Failed to register face.' });
    }
});

// Endpoint to get all registered faces
app.get('/api/registered-faces', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT name, descriptor FROM registered_faces');
        const faces = rows.map(row => {
            let descriptorValue = row.descriptor;

            if (typeof descriptorValue === 'string') {
                try {
                    const parsedDescriptor = JSON.parse(descriptorValue);
                    return {
                        name: row.name,
                        descriptor: parsedDescriptor
                    };
                } catch (parseError) {
                    console.error(`ERROR: Failed to JSON.parse descriptor for name "${row.name}".`);
                    return { name: row.name, descriptor: null };
                }
            } else {
                return { name: row.name, descriptor: null };
            }
        }).filter(face => face.descriptor !== null);

        res.status(200).json(faces);
    } catch (error) {
        console.error('Error fetching registered faces:', error);
        res.status(500).json({ error: 'Failed to fetch registered faces.' });
    }
});

// Endpoint to delete a registered face
app.delete('/api/registered-faces/:name', async (req, res) => {
    const { name } = req.params;
    try {
        const { rowCount } = await pool.query('DELETE FROM registered_faces WHERE name = $1', [name]);
        if (rowCount === 0) {
            return res.status(404).json({ error: 'Face not found.' });
        }
        res.status(200).json({ message: `Face for ${name} deleted successfully.` });
    } catch (error) {
        console.error('Error deleting face:', error);
        res.status(500).json({ error: 'Failed to delete face.' });
    }
});

// Endpoint to mark attendance
app.post('/api/mark-attendance', async (req, res) => {
    const { name, distance } = req.body;

    if (!name || distance === undefined) {
        return res.status(400).json({ error: 'Name and distance are required.' });
    }

    try {
        const { rows } = await pool.query(
            'INSERT INTO attendance_records (name, timestamp, distance) VALUES ($1, NOW(), $2) RETURNING *',
            [name, distance]
        );
        res.status(201).json({ message: 'Attendance marked successfully!', id: rows[0].id });
    } catch (error) {
        console.error('Error marking attendance:', error);
        res.status(500).json({ error: 'Failed to mark attendance.' });
    }
});

// Endpoint to get attendance log
app.get('/api/attendance-log', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT name, timestamp, distance FROM attendance_records ORDER BY timestamp DESC'
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching attendance log:', error);
        res.status(500).json({ error: 'Failed to fetch attendance log.' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
    console.log(`Frontend accessible at http://localhost:${port}/index.html`);
});
