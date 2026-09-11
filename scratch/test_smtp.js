import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'abrahamoluwaniyi50@gmail.com',
    pass: 'osqoybmxjaynlmmw',
  },
});

try {
  await transporter.verify();
  console.log('✅ SMTP connection verified — Gmail credentials are working!');
} catch (err) {
  console.error('❌ SMTP verification failed:', err.message);
}
