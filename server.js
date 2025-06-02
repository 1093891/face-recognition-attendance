// server.js (for MySQL)

const express = require('express');
const mysql = require('mysql2/promise'); // Using promise-based API for async/await
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;


app.use(cors({
    origin: '*' // Allows ALL websites to connect
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));

// MySQL Configuration
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ======================
// DATABASE INITIALIZATION
// ======================
async function initializeDatabase() {
    let connection;
    try {
        connection = await pool.getConnection(); // Get a connection from the pool

        // Create tables with proper constraints for MySQL
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS registered_faces (
                name VARCHAR(255) PRIMARY KEY,
                descriptor JSON NOT NULL,                 -- MySQL's JSON type
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS attendance_records (
                id INT AUTO_INCREMENT PRIMARY KEY,        -- MySQL's auto-incrementing ID
                name VARCHAR(255) NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                distance DECIMAL(5, 4)                    -- FLOAT is less precise, DECIMAL is better for exact numbers
            )`);

        console.log('✅ Database tables initialized (MySQL)');
    } catch (error) {
        console.error('❌ Database initialization failed (MySQL):', error.message);
        throw error; // Crash the app if tables can't be created
    } finally {
        if (connection) connection.release(); // Release the connection back to the pool
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
        // MySQL UPSERT syntax: ON DUPLICATE KEY UPDATE
        const [rows] = await pool.execute(
            `INSERT INTO registered_faces (name, descriptor)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE descriptor = VALUES(descriptor), timestamp = NOW()`,
            [name, JSON.stringify(descriptor)] // Use '?' placeholders and JSON.stringify
        );
        res.status(201).json(rows); // For INSERT/UPDATE, 'rows' contains affectedRows, insertId etc.
    } catch (error) {
        console.error('Database error (register-face):', error);
        res.status(500).json({ error: 'Failed to register face' });
    }
});

app.get('/api/registered-faces', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT name, descriptor FROM registered_faces'); // Use execute for promise-based mysql2
        
        const faces = rows.map(row => {
            let descriptorValue = row.descriptor; // This is what mysql2 returns for the JSON column

            // If the driver returns it as a string (common for JSON type in MySQL)
            if (typeof descriptorValue === 'string') {
                try {
                    const parsedDescriptor = JSON.parse(descriptorValue);
                    return {
                        name: row.name,
                        descriptor: parsedDescriptor
                    };
                } catch (parseError) {
                    // This catch block is crucial for debugging malformed JSON
                    console.error(`ERROR: Failed to JSON.parse descriptor for name "${row.name}".`);
                    console.error(`       Problematic descriptor string: "${descriptorValue}"`);
                    console.error(`       Parse error details:`, parseError);
                    return { name: row.name, descriptor: null }; // Return null if parsing fails
                }
            } else if (typeof descriptorValue === 'object' && descriptorValue !== null) {
                // If mysql2 driver already converted it to a JS object/array directly (less common but possible)
                return {
                    name: row.name,
                    descriptor: descriptorValue
                };
            } else {
                // Handle unexpected types for the descriptor
                console.warn(`WARNING: Descriptor for name "${row.name}" is not a string or object. Type: ${typeof descriptorValue}. Value:`, descriptorValue);
                return { name: row.name, descriptor: null };
            }
        }).filter(face => face.descriptor !== null); // Filter out any entries where descriptor parsing failed

        res.json(faces);
    } catch (error) {
        console.error('Error fetching faces (registered-faces):', error);
        res.status(500).json({ error: 'Database operation failed' });
    }
});

app.post('/api/mark-attendance', async (req, res) => {
    const { name, distance } = req.body;
    
    if (!name || distance === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Insert a new attendance record
        const [rows] = await pool.execute(
            `INSERT INTO attendance_records (name, distance)
             VALUES (?, ?)`, // Use '?' placeholders
            [name, distance]
        );
        res.status(201).json(rows); // For INSERT, 'rows' contains affectedRows, insertId etc.
    } catch (error) {
        console.error('Error marking attendance:', error);
        res.status(500).json({ error: 'Database operation failed' });
    }
});

app.get('/api/attendance-log', async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT name, timestamp, distance FROM attendance_records 
            ORDER BY timestamp DESC
            LIMIT 100
        `);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching attendance log:', error);
        res.status(500).json({ error: 'Database operation failed' });
    }
});

// ======================
// START SERVER
// ======================
async function startServer() {
    try {
        // Test connection before listening
        await pool.getConnection()
            .then(connection => {
                console.log('✅ MySQL pool connection successful before server start.');
                connection.release();
            })
            .catch(err => {
                console.error('❌ MySQL pool test failed on startup:', err.message);
                process.exit(1); // Exit if cannot connect to DB
            });

        await initializeDatabase(); // Create tables if they don't exist
        
        app.listen(port, () => {
            console.log(`🚀 Server running on port ${port}`);
            console.log(`🔗 MySQL connected`);
        });
    } catch (error) {
        console.error('🔥 Fatal startup error:', error);
        process.exit(1);
    }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
    pool.end(() => { // Close the MySQL connection pool
        console.log('🛑 Database connection pool closed');
        process.exit(0);
    });
});
