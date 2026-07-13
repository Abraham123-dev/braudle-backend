import mongoose from 'mongoose';
import { env } from './env.js';

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return;
  }
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      await mongoose.connect(env.mongoUri, {
        serverSelectionTimeoutMS: 5000,
      });
      console.log(' MongoDB connected successfully');
      return;
    } catch (error) {
      retries++;
      console.error(`❌ MongoDB connection attempt ${retries}/${maxRetries} failed:`, error.message);
      if (retries >= maxRetries) {
        console.error('❌ MongoDB connection failed after maximum retries. Exiting...');
        process.exit(1);
      }
      console.log('Retrying MongoDB connection in 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
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
