import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

/**
 * Reusable SMTP transporter (singleton — created once at module load).
 * Nodemailer pools connections automatically for performance.
 */
const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: env.smtp.secure, // true for port 465 (SSL), false for 587 (STARTTLS)
  auth: {
    user: env.smtp.user,
    pass: env.smtp.pass,
  },
});

/**
 * Verify SMTP connection on startup so failures are caught early and
 * show up clearly in Render logs — not silently at send time.
 */
transporter.verify((err, success) => {
  if (err) {
    console.error('❌ [SMTP] Connection FAILED on startup:');
    console.error(`   Host:  ${env.smtp.host}:${env.smtp.port}`);
    console.error(`   User:  ${env.smtp.user}`);
    console.error(`   Error: ${err.message}`);
  } else {
    console.log(`✅ [SMTP] Connected to ${env.smtp.host}:${env.smtp.port} as ${env.smtp.user}`);
  }
});

/**
 * Sends a magic login link to the user via SMTP.
 */
export const sendMagicLink = async (email, token) => {
  const loginUrl = `${env.frontendUrl}/auth/callback?token=${token}`;

  // Log the magic link to console in development mode so developers can login easily without checking email
  if (env.nodeEnv === 'development') {
    console.log('\n✉️  [DEVELOPMENT] MAGIC LOGIN LINK GENERATED:');
    console.log(`👉 Email: ${email}`);
    console.log(`👉 Link:  ${loginUrl}\n`);
  }

  try {
    console.log(`📧 [SMTP] Sending magic link to: ${email}`);

    const info = await transporter.sendMail({
      from: env.smtp.from,
      to: email,
      subject: 'Your BRAUDLE Magic Login Link',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>Your BRAUDLE Magic Login Link</title>
          </head>
          <body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0b0f19; padding: 40px 20px;">
              <tr>
                <td align="center">
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);">
                    <!-- Header -->
                    <tr>
                      <td align="center" style="padding: 30px 40px 20px 40px; border-bottom: 1px solid #1f2937;">
                        <span style="font-size: 24px; font-weight: 800; color: #22c55e; letter-spacing: 3px; font-family: system-ui, sans-serif;">BRAUDLE</span>
                        <div style="font-size: 13px; color: #9ca3af; margin-top: 5px;">Your Personal AI Tutor</div>
                      </td>
                    </tr>
                    <!-- Body Content -->
                    <tr>
                      <td style="padding: 45px 40px 35px 40px; text-align: center;">
                        <h2 style="font-size: 20px; font-weight: 700; color: #ffffff; margin: 0 0 14px 0;">Verify your login</h2>
                        <p style="font-size: 14px; line-height: 1.5; color: #9ca3af; margin: 0 0 26px 0;">
                          Click the button below to finish signing in to your BRAUDLE account.
                        </p>
                        <!-- Button -->
                        <table border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                          <tr>
                            <td align="center" style="border-radius: 8px; background-color: #22c55e;">
                              <a href="${loginUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: bold; color: #0b0f19; text-decoration: none; border-radius: 8px;">
                                Verify and Log In
                              </a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <!-- Footer / Notice -->
                    <tr>
                      <td style="padding: 0 40px 30px 40px; text-align: center;">
                        <p style="font-size: 12px; color: #4b5563; margin: 0 0 16px 0; line-height: 1.4;">
                          This magic link is valid for 15 minutes and can only be used once.
                        </p>
                        <div style="border-top: 1px solid #1f2937; padding-top: 20px;">
                          <p style="font-size: 11px; color: #4b5563; margin: 0;">
                            If you didn't request this email, you can safely ignore it.
                          </p>
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `,
    });

    console.log(`✅ [SMTP] Email sent successfully. MessageId: ${info.messageId}`);
    return info;

  } catch (err) {
    // Always log the full error — visible in both dev and Render production logs
    console.error('❌ [SMTP] Failed to send email:');
    console.error(`   To:    ${email}`);
    console.error(`   Error: ${err.message}`);
    console.error(`   Code:  ${err.code || 'N/A'}`);

    if (env.nodeEnv === 'development') {
      // In development, do not crash the request — dev can copy the link from console output
      console.warn('⚠️  [SMTP] Dev mode: returning mock response. Use the link printed above.');
      return { messageId: 'dev_mock_id' };
    }

    throw err;
  }
};
