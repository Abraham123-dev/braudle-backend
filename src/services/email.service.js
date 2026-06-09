import { Resend } from 'resend';
import { env } from '../config/env.js';

const resend = new Resend(env.resend.apiKey);

/**
 * Sends a magic login link to the user
 */
export const sendMagicLink = async (email, token) => {
  const loginUrl = `${env.frontendUrl}/auth/verify?token=${token}`;

  return await resend.emails.send({
    // Production: Switch to 'BRAUDLE <auth@braudle.com>' after verifying your domain in Resend
    from: 'BRAUDLE <onboarding@resend.dev>', 
    to: email,
    subject: 'Your BRAUDLE Magic Login Link',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 40px; background-color: #000; color: #fff; border-radius: 12px; text-align: center;">
        <h1 style="color: #22c55e; font-size: 32px; margin-bottom: 10px; letter-spacing: 2px;">BRAUDLE</h1>
        <h2 style="font-size: 18px; font-weight: normal; margin-bottom: 30px; color: #eee;">Your Personal AI Tutor</h2>
        <p style="color: #aaa; line-height: 1.6; margin-bottom: 30px;">Click the button below to log in to your account. This link is valid for 15 minutes and can only be used once.</p>
        <a href="${loginUrl}" style="background-color: #22c55e; color: #000; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">Log In to BRAUDLE</a>
        <p style="margin-top: 40px; font-size: 12px; color: #555; border-top: 1px solid #222; padding-top: 20px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
};