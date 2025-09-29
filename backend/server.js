// server.js - Node.js + Express backend for MongoDB
const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection string - use direct URI if provided, otherwise build from components
let mongoUri;

if (process.env.MONGODB_URI) {
    // Use the complete URI if provided (for existing MongoDB instances)
    mongoUri = process.env.MONGODB_URI;
    // Change the database name in the URI to love_journey
    mongoUri = mongoUri.replace(/\/freight\?/, '/love_journey?');
} else {
    // Build from individual components (for docker-compose setup)
    const MONGO_HOST = process.env.MONGO_HOST || 'mongodb';
    const MONGO_PORT = process.env.MONGO_PORT || '27017';
    const MONGO_DB = process.env.MONGO_DB || 'love_journey';
    const MONGO_USER = process.env.MONGO_USER || '';
    const MONGO_PASS = process.env.MONGO_PASS || '';
    
    if (MONGO_USER && MONGO_PASS) {
        mongoUri = `mongodb://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOST}:${MONGO_PORT}/${MONGO_DB}?authSource=admin`;
    } else {
        mongoUri = `mongodb://${MONGO_HOST}:${MONGO_PORT}/${MONGO_DB}`;
    }
}

console.log('Connecting to MongoDB at:', mongoUri.replace(/\/\/.*@/, '//<credentials>@'));

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // Increased limit for image data
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// MongoDB client
let db;
let journeyCollection;

// Connect to MongoDB
MongoClient.connect(mongoUri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
})
.then(client => {
    console.log('Connected to MongoDB successfully!');
    db = client.db('love_journey');
    journeyCollection = db.collection('destinations');
    
    // Create indexes for better performance
    journeyCollection.createIndex({ timestamp: 1 }).catch(err => console.log('Index exists or error:', err));
})
.catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        mongodb: db ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// Get all destinations
app.get('/api/destinations', async (req, res) => {
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    app.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});
