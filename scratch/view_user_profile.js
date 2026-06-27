import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import StudentProfile from '../src/models/StudentProfile.model.js';
import User from '../src/models/User.model.js';

async function viewProfile() {
  await connectDB();

  try {
    const user = await User.findOne({ name: /Oluwaniyi/i });
    if (!user) {
      console.log('User Oluwaniyi not found. Listing all users:');
      const allUsers = await User.find({});
      allUsers.forEach(u => console.log(`- ID: ${u._id}, Name: ${u.name}, Email: ${u.email}`));
      return;
    }

    console.log(`Found User: ID=${user._id}, Name=${user.name}, Email=${user.email}`);

    const profile = await StudentProfile.findOne({ userId: user._id });
    if (!profile) {
      console.log('Student profile not found.');
      return;
    }

    console.log('\n--- STUDENT PROFILE DATA ---');
    console.log(JSON.stringify(profile, null, 2));

  } catch (err) {
    console.error('Error viewing profile:', err);
  } finally {
    await mongoose.connection.close();
  }
}

viewProfile();
