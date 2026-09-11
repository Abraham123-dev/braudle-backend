import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'abrahamoluwaniyi50@gmail.com',
    pass: 'osqoybmxjaynlmmw',
  },
});

try {
  console.log('Sending test email to abrahamoluwaniyi50@gmail.com...');
  const info = await transporter.sendMail({
    from: 'BRAUDLE <abrahamoluwaniyi50@gmail.com>',
    to: 'abrahamoluwaniyi50@gmail.com',
    subject: 'BRAUDLE Test Email - Gmail SMTP Working!',
    text: 'Hello Abraham! Your Gmail SMTP is officially working.',
  });
  console.log('✅ Email sent successfully! MessageId:', info.messageId);
} catch (err) {
  console.error('❌ Failed to send test email:', err);
}
