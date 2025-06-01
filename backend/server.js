// backend/server.js

const express = require('express');
const mysql = require('mysql2/promise'); // Using promise-based API for async/await
const path = require('path');
const cors = require('cors'); // Required for cross-origin requests from frontend
require('dotenv').config(); // Load environment variables from .env file

const app = express();
const port = 3000; // Backend server port

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(express.json({ limit: '50mb' })); // To parse JSON request bodies, increase limit for descriptors

// Serve static files from the frontend directory
// This allows the Node.js server to serve your index.html, app.js, style.css, and models
app.use(express.static(path.join(__dirname, '../frontend')));

// MySQL Connection Pool (recommended for production)
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost', // Defaults to 'localhost' if not set in .env
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306, // Parse port as integer

});

// Test MySQL connection
pool.getConnection()
    .then(connection => {
        console.log('Connected to MySQL database!');
        connection.release(); // Release the connection immediately after testing
    })
    .catch(err => {
        console.error('Error connecting to MySQL:', err.message);
        console.error('Please ensure MySQL is running and database "face_attendance_db" exists.');
        console.error('Also, check your MySQL user credentials and authentication plugin (e.g., mysql_native_password for MySQL 8+).');
    });

// --- API Endpoints ---

// Endpoint to register a new face
app.post('/api/register-face', async (req, res) => {
    const { name, descriptor } = req.body; // descriptor is expected to be an array of numbers

    if (!name || !descriptor || !Array.isArray(descriptor)) {
        console.warn('Register Face: Invalid request - missing name or descriptor.');
        return res.status(400).json({ error: 'Name and valid descriptor (array) are required.' });
    }

    try {
        console.log(`Register Face: Received descriptor for "${name}" (type: ${typeof descriptor}, length: ${descriptor.length})`);
        const descriptorJsonString = JSON.stringify(descriptor); // Convert array to JSON string for storage
        console.log(`Register Face: Descriptor after JSON.stringify: "${descriptorJsonString.substring(0, Math.min(descriptorJsonString.length, 100))}..." (showing first 100 chars)`); // Log first 100 chars

        // SQL query to insert or update a registered face
        // ON DUPLICATE KEY UPDATE ensures that if a name already exists, its descriptor is updated
        const [rows] = await pool.execute(
            'INSERT INTO registered_faces (name, descriptor, timestamp) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE descriptor = ?, timestamp = NOW()',
            [name, descriptorJsonString, descriptorJsonString] // Use the JSON string for both insert and update
        );
        console.log(`Register Face: Data inserted/updated for "${name}". Affected rows: ${rows.affectedRows}`);
        res.status(201).json({ message: 'Face registered successfully!', id: rows.insertId });
    } catch (error) {
        console.error('Error registering face:', error);
        res.status(500).json({ error: 'Failed to register face.' });
    }
});

// Endpoint to get all registered faces
app.get('/api/registered-faces', async (req, res) => {
    try {
        console.log('Fetching all registered faces...');
        const [rows] = await pool.execute('SELECT name, descriptor FROM registered_faces');
        console.log(`Fetched ${rows.length} rows from registered_faces.`);

        const faces = rows.map(row => {
            let descriptorValue = row.descriptor; // This is what the mysql2 driver returns for the JSON column

            console.log(`  Processing row for "${row.name}": Descriptor type from DB: ${typeof descriptorValue}`);
            // Uncomment the line below if you need to see the full raw value from the database for debugging
            // console.log(`  Raw descriptor value from DB:`, descriptorValue); 

            if (typeof descriptorValue === 'string') {
                // If the driver returns it as a string (common for JSON type)
                try {
                    const parsedDescriptor = JSON.parse(descriptorValue);
                    console.log(`  Parsed descriptor successfully for "${row.name}". (Is Array: ${Array.isArray(parsedDescriptor)})`);
                    return {
                        name: row.name,
                        descriptor: parsedDescriptor
                    };
                } catch (parseError) {
                    // This catch block is crucial for debugging malformed JSON
                    console.error(`ERROR: Failed to JSON.parse descriptor for name "${row.name}".`);
                    console.error(`       Problematic descriptor string: "${descriptorValue}"`); // This log is key for identifying bad data
                    console.error(`       Parse error details:`, parseError);
                    return { name: row.name, descriptor: null }; // Return null if parsing fails
                }
            } else if (typeof descriptorValue === 'object' && descriptorValue !== null) {
                // If the mysql2 driver already converted it to a JS object/array directly (less common but possible)
                console.log(`  Descriptor for "${row.name}" already an object/array from DB.`);
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

        res.status(200).json(faces);
        console.log(`Successfully returned ${faces.length} parsed faces.`);
    } catch (error) {
        console.error('Error fetching registered faces:', error);
        res.status(500).json({ error: 'Failed to fetch registered faces.' });
    }
});

// Endpoint to delete a registered face
app.delete('/api/registered-faces/:name', async (req, res) => {
    const { name } = req.params; // Get the name from the URL parameter
    try {
        const [result] = await pool.execute('DELETE FROM registered_faces WHERE name = ?', [name]);
        if (result.affectedRows === 0) {
            console.warn(`Delete Face: Face with name "${name}" not found.`);
            return res.status(404).json({ error: 'Face not found.' });
        }
        console.log(`Delete Face: Face for "${name}" deleted successfully.`);
        res.status(200).json({ message: `Face for ${name} deleted successfully.` });
    } catch (error) {
        console.error('Error deleting face:', error);
        res.status(500).json({ error: 'Failed to delete face.' });
    }
});

// Endpoint to mark attendance
app.post('/api/mark-attendance', async (req, res) => {
    const { name, distance } = req.body; // Get name and recognition distance from request body

    if (!name || distance === undefined) {
        console.warn('Mark Attendance: Invalid request - missing name or distance.');
        return res.status(400).json({ error: 'Name and distance are required.' });
    }

    try {
        // Insert a new attendance record
        const [rows] = await pool.execute(
            'INSERT INTO attendance_records (name, timestamp, distance) VALUES (?, NOW(), ?)',
            [name, distance]
        );
        console.log(`Mark Attendance: Record added for "${name}" with distance ${distance}.`);
        res.status(201).json({ message: 'Attendance marked successfully!', id: rows.insertId });
    } catch (error) {
        console.error('Error marking attendance:', error);
        res.status(500).json({ error: 'Failed to mark attendance.' });
    }
});

// Endpoint to get attendance log
// This endpoint now supports optional date and time range parameters for fetching specific logs
app.get('/api/attendance-log', async (req, res) => {
    try {
        // Fetch latest 10 attendance records, ordered by timestamp descending
        // For the report feature, the frontend will filter by date/time.
        // If you need to optimize for very large datasets, you'd add WHERE clauses here.
        const [rows] = await pool.execute('SELECT name, timestamp, distance FROM attendance_records ORDER BY timestamp DESC'); // Removed LIMIT 10 for full report data
        console.log(`Fetched ${rows.length} attendance records.`);
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
