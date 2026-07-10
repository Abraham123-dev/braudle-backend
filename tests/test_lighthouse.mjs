import { connectDB, mongoose } from '../src/config/db.js';
import AppErrorLog from '../src/models/AppErrorLog.model.js';
import User from '../src/models/User.model.js';

const BASE_URL = 'http://localhost:5000/api';

async function runTests() {
  console.log('--- 🧪 Connecting to database to clear test records ---');
  await connectDB();
  
  // Clear any existing test logs
  await AppErrorLog.deleteMany({ message: /Lighthouse Test Error/ });

  console.log('\n--- 🧪 Testing Admin Login Authentication ---');
  
  // Test 1: Invalid login credentials
  const badLoginRes = await fetch(`${BASE_URL}/admin/lighthouse/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'abrahamoluwaniyi50@gmail.com',
      password: 'wrongpassword'
    })
  });
  
  console.log(`Bad credentials status: ${badLoginRes.status}`);
  if (badLoginRes.status !== 401) {
    throw new Error('Test 1 failed: Bad credentials should return 401');
  }
  console.log('✅ PASS: Bad credentials rejected correctly');

  // Test 2: Valid login credentials
  const loginRes = await fetch(`${BASE_URL}/admin/lighthouse/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'abrahamoluwaniyi50@gmail.com',
      password: 'braudleCEO'
    })
  });
  
  const loginBody = await loginRes.json();
  console.log(`Good credentials status: ${loginRes.status}`);
  if (loginRes.status !== 200 || !loginBody.token) {
    throw new Error('Test 2 failed: Correct credentials should return token');
  }
  const token = loginBody.token;
  console.log('✅ PASS: Admin authenticated successfully, token obtained');

  console.log('\n--- 🧪 Testing Route Protection (RBAC) ---');

  // Test 3: Fetch stats without token
  const unauthStatsRes = await fetch(`${BASE_URL}/admin/lighthouse/stats`);
  console.log(`Unauthenticated stats status: ${unauthStatsRes.status}`);
  if (unauthStatsRes.status !== 401) {
    throw new Error('Test 3 failed: Stats without token should return 401');
  }
  console.log('✅ PASS: Stats endpoint correctly blocked unauthenticated request');

  // Test 4: Fetch stats with token
  const statsRes = await fetch(`${BASE_URL}/admin/lighthouse/stats`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const statsBody = await statsRes.json();
  console.log(`Authenticated stats status: ${statsRes.status}`);
  if (statsRes.status !== 200) {
    throw new Error('Test 4 failed: Stats with correct token should return 200');
  }
  console.log(`Total users registered: ${statsBody.users.total}`);
  console.log(`Platform database health status: MongoDB is ${statsBody.system.mongodb}`);
  console.log('✅ PASS: Stats retrieved successfully with admin auth');

  console.log('\n--- 🧪 Testing Error House centralized logger ---');

  // Create a test log directly in DB
  const mockError = await AppErrorLog.create({
    errorId: `err_test_${Math.random().toString(36).substr(2, 6)}`,
    message: 'Lighthouse Test Error: simulated backend failure',
    stack: 'Error: simulated backend failure\n    at runTests (tests/test_lighthouse.mjs:70:9)',
    statusCode: 500,
    source: 'api',
    route: '/api/test/fail',
    method: 'GET',
    ip: '127.0.0.1'
  });
  
  console.log(`Mock error log created with ID: ${mockError.errorId}`);

  // Test 5: Query logs list via API
  const logsRes = await fetch(`${BASE_URL}/admin/lighthouse/errors?isResolved=false`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const logsBody = await logsRes.json();
  
  console.log(`Errors log list status: ${logsRes.status}`);
  const foundLog = logsBody.logs.find(log => log.errorId === mockError.errorId);
  if (!foundLog) {
    throw new Error('Test 5 failed: Could not retrieve recently logged error via API');
  }
  console.log('✅ PASS: Newly logged error successfully retrieved from Error House API');

  // Test 6: Mark error as resolved
  const resolveRes = await fetch(`${BASE_URL}/admin/lighthouse/errors/${mockError._id}/resolve`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const resolveBody = await resolveRes.json();
  
  console.log(`Resolve error log status: ${resolveRes.status}`);
  if (resolveRes.status !== 200 || !resolveBody.log.isResolved) {
    throw new Error('Test 6 failed: Resolve endpoint should return 200 and set isResolved true');
  }
  console.log('✅ PASS: Error resolved successfully via API');

  // Clean up
  await AppErrorLog.findByIdAndDelete(mockError._id);
  await mongoose.disconnect();
  console.log('\n--- 🎉 All Lighthouse Admin Integration Tests Passed! ---');
}

runTests().catch(err => {
  console.error('❌ Test suite failed:', err);
  mongoose.disconnect();
  process.exit(1);
});
