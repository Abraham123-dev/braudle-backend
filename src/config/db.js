import mongoose from 'mongoose';
import { env } from './env.js';

const connectDB = async () => {
  try {
    await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(' MongoDB connected successfully');
  } catch (error) {
    console.warn(' MongoDB connection failed:', error.message);
    console.warn('Server will continue without database — add MongoDB connection when ready');
  }
};

// Mongoose event listeners for connection monitoring
mongoose.connection.on('disconnected', () => {
  console.warn(' MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error(' MongoDB error:', err);
});

export { connectDB, mongoose };
