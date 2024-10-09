require('dotenv').config(); // Load environment variables

const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

// Initialize Express app
const app = express();
app.use(express.json());
app.use(cors());

app.use((req, res, next) => {
    console.log(`Incoming request: ${req.method} ${req.url}`);
    console.log('Body:', req.body);
    next();
});

// Database configurations
const dbName = 'eventBookingSystem';
const usersCollection = 'users';
const eventsCollection = 'events'; 
const bookingsCollection = 'bookings';
let db;

// Connect to MongoDB
MongoClient.connect('mongodb://localhost:27017')
    .then((client) => {
        db = client.db(dbName);
        console.log('Connected to MongoDB');
    })
    .catch((error) => console.error('Error connecting to MongoDB:', error));

// Middleware to verify JWT tokens
const authenticateJWT = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(403).json({ message: 'Token required' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid token' });
        req.user = user;
        next();
    });
};

// User Registration
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = { name, email, password: hashedPassword, isAdmin: false };

        const result = await db.collection(usersCollection).insertOne(user);
        if (result.insertedId) {
            res.status(201).json({ message: 'User registered successfully' });
        } else {
            res.status(400).json({ message: 'Failed to register user' });
        }
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// User Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        const user = await db.collection(usersCollection).findOne({ email });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) return res.status(400).json({ message: 'Invalid password' });

        if (!process.env.JWT_SECRET) {
            return res.status(500).json({ message: 'JWT Secret is not defined' });
        }

        const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, process.env.JWT_SECRET, {
            expiresIn: '1h',
        });

        res.json({ token });
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ error: error.message });
    }
});

console.log('JWT Secret:', process.env.JWT_SECRET);

// Get All Events
app.get('/api/events', async (req, res) => {
    try {
        const events = await db.collection(eventsCollection).find().toArray();
        res.json(events);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Book Tickets
app.post('/api/bookings', authenticateJWT, async (req, res) => {
    try {
        const { eventId, seats } = req.body;

        if (!eventId || !Array.isArray(seats)) {
            return res.status(400).json({ message: 'Invalid request format' });
        }

        const event = await db.collection(eventsCollection).findOne({ _id: new ObjectId(eventId) });
        if (!event) return res.status(404).json({ message: 'Event not found' });

        const existingBookings = await db.collection(bookingsCollection).find({ event: new ObjectId(eventId) }).toArray();
        const bookedSeats = existingBookings.flatMap((booking) => booking.seats);

        // Check if the requested seats are available
        const unavailableSeats = seats.filter((seat) => bookedSeats.includes(seat));
        if (unavailableSeats.length > 0) {
            return res.status(400).json({ message: `Seats ${unavailableSeats.join(', ')} are already booked` });
        }

        const booking = {
            user: new ObjectId(req.user.id),
            event: new ObjectId(eventId),
            seats,
            bookingDate: new Date(),
        };

        const result = await db.collection(bookingsCollection).insertOne(booking);
        if (result.insertedId) {
            res.status(201).json({ message: 'Booking successful' });
        } else {
            res.status(400).json({ message: 'Booking failed' });
        }
    } catch (error) {
        console.error('Error during booking:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get Booking History for All Bookings
app.get('/api/bookings/history', authenticateJWT, async (req, res) => {
    try {
        const bookings = await db.collection(bookingsCollection).find().toArray();

        const populatedBookings = await Promise.all(
            bookings.map(async (booking) => {
                const event = await db.collection(eventsCollection).findOne({ _id: booking.event });
                return { ...booking, event };
            })
        );

        res.json(populatedBookings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to get bookings for a specific event
app.get('/api/events/:eventId/bookings', async (req, res) => {
    try {
        const eventId = req.params.eventId;
        const bookings = await db.collection(bookingsCollection)
            .find({ event: new ObjectId(eventId) })
            .toArray();

        // Extract all booked seats for the event
        const bookedSeats = bookings.flatMap((booking) => booking.seats);

        res.json(bookedSeats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: Create an Event
app.post('/api/admin/events', authenticateJWT, async (req, res) => {
    try {
        if (!req.user.isAdmin) return res.status(403).json({ message: 'Access denied' });

        const { imageUrl, name, category, date, seats } = req.body;
        const event = {
            imageUrl,
            name,
            category,
            //date: new Date(date),
            date:date,
            seats: seats || 100 // Default seats to 100
        };

        const result = await db.collection(eventsCollection).insertOne(event);
        if (result.insertedId) {
            res.status(201).json({ message: 'Event created successfully' });
        } else {
            res.status(400).json({ message: 'Failed to create event' });
        }
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
