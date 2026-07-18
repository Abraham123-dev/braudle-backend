import dotenv from 'dotenv';
dotenv.config();
import { connectDB } from '../src/config/db.js';
import Document from '../src/models/Document.model.js';

async function check() {
  await connectDB();
  const docs = await Document.find({ summary: { $regex: /151 math problems/i } });
  console.log(`Found ${docs.length} documents with "151 math problems"`);
  if (docs.length > 0) {
    console.log(JSON.stringify(docs[0], null, 2));
  }
  process.exit(0);
}
check();
