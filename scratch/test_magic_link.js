import { sendMagicLink } from '../src/services/email.service.js';

console.log('Testing sendMagicLink with token 123456...');
try {
  const result = await sendMagicLink('abrahamoluwaniyi50@gmail.com', 'test_magic_token_abc_123');
  console.log('Result:', result);
  console.log('✅ TEST PASSED: Magic link email sent via sendMagicLink successfully!');
} catch (err) {
  console.error('❌ TEST FAILED:', err);
}
