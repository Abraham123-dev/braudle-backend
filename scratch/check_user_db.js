import { connectDB } from '../src/config/db.js';
import User from '../src/models/User.model.js';

async function check() {
  await connectDB();
  try {
    const user = await User.findOne({ email: 'osaniyi222@gmail.com' });
    if (user) {
      console.log('User found:');
      console.log('ID:', user._id);
      console.log('Name:', user.name);
      console.log('Email:', user.email);
      console.log('Plan:', user.plan);
      console.log('Upload Count:', JSON.stringify(user.uploadCount));
      console.log('Last Upload Date:', user.lastUploadDate);
    } else {
      console.log('User not found in DB!');
    }
  } catch (err) {
    console.error('Error:', err);
  }
  process.exit(0);
}

check();
