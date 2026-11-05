import { sendMagicLink } from '../src/services/email.service.js';

console.log('Sending test magic link to jakeroland3512@gmail.com...');
try {
  const result = await sendMagicLink('jakeroland3512@gmail.com', 'test_token_for_jake_987654');
  console.log('✅ Send result:', result);
  console.log('🎉 Email sent to jakeroland3512@gmail.com successfully!');
} catch (err) {
  console.error('❌ Error sending email:', err);
}
