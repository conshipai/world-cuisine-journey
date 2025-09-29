// server.js - Node.js + Express backend for MongoDB
const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3005;

// MongoDB connection
let mongoUri = process.env.MONGODB_URI;
let dbName = 'love_journey';

if (!mongoUri) {
    console.error('MONGODB_URI environment variable is not set!');
    console.error('Please set MONGODB_URI in your environment variables');
    process.exit(1);
}

// Parse database name from URI
const dbNameMatch = mongoUri.match(/\/([^/?]+)(\?|$)/);
if (dbNameMatch && dbNameMatch[1]) {
    dbName = dbNameMatch[1];
    console.log('Using database from URI:', dbName);
} else {
    // If no database in URI, append it
    if (mongoUri.includes('?')) {
        mongoUri = mongoUri.replace('?', '/love_journey?');
    } else {
        mongoUri = mongoUri + '/love_journey';
    }
    console.log('Database name not found in URI, using default:', dbName);
}

console.log('Connecting to MongoDB...');
console.log('Database:', dbName);
console.log('URI:', mongoUri.replace(/:\/\/([^:]+):([^@]+)@/, '://<user>:<pass>@'));

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// MongoDB client
let db;
let journeyCollection;

// Connect to MongoDB with retry logic
const connectWithRetry = () => {
    MongoClient.connect(mongoUri, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        },
        connectTimeoutMS: 10000,
        serverSelectionTimeoutMS: 10000,
    })
    .then(client => {
        console.log('Connected to MongoDB successfully!');
        db = client.db(dbName);
        journeyCollection = db.collection('destinations');
        
        // Create indexes for better performance
        journeyCollection.createIndex({ timestamp: 1 })
            .then(() => console.log('Index created or already exists'))
            .catch(err => console.log('Index error:', err));
    })
    .catch(err => {
        console.error('MongoDB connection error:', err.message);
        console.log('Retrying connection in 5 seconds...');
        setTimeout(connectWithRetry, 5000);
    });
};

// Start connection
connectWithRetry();

// Health check endpoint
app.get('/health', (req, res) => {
    const isConnected = db !== undefined;
    const status = isConnected ? 'healthy' : 'connecting';
    
    res.status(isConnected ? 200 : 503).json({ 
        status: status,
        mongodb: isConnected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// Get all destinations
app.get('/api/destinations', async (req, res) => {
    if (!journeyCollection) {
        return res.status(503).json({ 
            success: false, 
            error: 'Database connection not ready' 
        });
    }
    
    try {
        const destinations = await journeyCollection
            .find({})
            .sort({ timestamp: 1 })
            .toArray();
        
        res.json({
            success: true,
            data: destinations,
            count: destinations.length
        });
    } catch (error) {
        console.error('Error fetching destinations:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch destinations' 
        });
    }
});

// Add a new destination
app.post('/api/destinations', async (req, res) => {
    if (!journeyCollection) {
        return res.status(503).json({ 
            success: false, 
            error: 'Database connection not ready' 
        });
    }
    
    try {
        const destination = {
            ...req.body,
            timestamp: new Date(),
            _id: undefined // Let MongoDB generate the ID
        };
        
        // Validate required fields
        if (!destination.city || !destination.coords) {
            return res.status(400).json({
                success: false,
                error: 'City and coordinates are required'
            });
        }
        
        const result = await journeyCollection.insertOne(destination);
        
        res.json({
            success: true,
            data: {
                ...destination,
                _id: result.insertedId
            },
            message: 'Destination added successfully'
        });
    } catch (error) {
        console.error('Error adding destination:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to add destination' 
        });
    }
});

// Update a destination
app.put('/api/destinations/:id', async (req, res) => {
    if (!journeyCollection) {
        return res.status(503).json({ 
            success: false, 
            error: 'Database connection not ready' 
        });
    }
    
    try {
        const { id } = req.params;
        const { ObjectId } = require('mongodb');
        
        // Remove _id from update data if present
        const updateData = { ...req.body };
        delete updateData._id;
        
        const result = await journeyCollection.updateOne(
            { _id: new ObjectId(id) },
            { 
                $set: {
                    ...updateData,
                    lastModified: new Date()
                }
            }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                error: 'Destination not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Destination updated successfully'
        });
    } catch (error) {
        console.error('Error updating destination:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to update destination' 
        });
    }
});

// Delete a destination
app.delete('/api/destinations/:id', async (req, res) => {
    if (!journeyCollection) {
        return res.status(503).json({ 
            success: false, 
            error: 'Database connection not ready' 
        });
    }
    
    try {
        const { id } = req.params;
        const { ObjectId } = require('mongodb');
        
        const result = await journeyCollection.deleteOne({
            _id: new ObjectId(id)
        });
        
        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                error: 'Destination not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Destination deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting destination:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to delete destination' 
        });
    }
});

// Clear all destinations (protected with password)
app.post('/api/destinations/clear', async (req, res) => {
    if (!journeyCollection) {
        return res.status(503).json({ 
            success: false, 
            error: 'Database connection not ready' 
        });
    }
    
    try {
        const { password } = req.body;
        
        // Check password
        if (password !== 'iloveyou') {
            return res.status(401).json({
                success: false,
                error: 'Invalid password'
            });
        }
        
        const result = await journeyCollection.deleteMany({});
        
        res.json({
            success: true,
            message: `Cleared ${result.deletedCount} destinations`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error('Error clearing destinations:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to clear destinations' 
        });
    }
});

// Import journey data (for restoring from export)
app.post('/api/destinations/import', async (req, res) => {
    if (!journeyCollection) {
        return res.status(503).json({ 
            success: false, 
            error: 'Database connection not ready' 
        });
    }
    
    try {
        const { password, destinations } = req.body;
        
        // Check password
        if (password !== 'iloveyou') {
            return res.status(401).json({
                success: false,
                error: 'Invalid password'
            });
        }
        
        if (!Array.isArray(destinations)) {
            return res.status(400).json({
                success: false,
                error: 'Destinations must be an array'
            });
        }
        
        // Clear existing data first
        await journeyCollection.deleteMany({});
        
        // Add timestamps to imported data
        const destinationsWithTimestamps = destinations.map((dest, index) => ({
            ...dest,
            timestamp: new Date(Date.now() + index * 1000), // Stagger timestamps
            _id: undefined
        }));
        
        if (destinationsWithTimestamps.length > 0) {
            const result = await journeyCollection.insertMany(destinationsWithTimestamps);
            
            res.json({
                success: true,
                message: `Imported ${result.insertedCount} destinations`,
                count: result.insertedCount
            });
        } else {
            res.json({
                success: true,
                message: 'No destinations to import',
                count: 0
            });
        }
    } catch (error) {
        console.error('Error importing destinations:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to import destinations' 
        });
    }
});

// Start server - bind to all interfaces
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Server is listening on all interfaces`);
    console.log(`Note: Nginx will proxy from port 80 to backend on port ${PORT}`);
});

// Handle server errors
server.on('error', (error) => {
    console.error('Server error:', error);
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
        console.error('Please ensure no other service is using this port');
        process.exit(1);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    process.exit(0);
});
