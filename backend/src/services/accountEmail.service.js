/**
 * accountEmail.service.js — email about a PEA sign-in account: login details
 * and password reset links.
 *
 * These are the ONE exception to the non-production redirect, exactly as in
 * ATS (config/emailRecipients.js → NEVER_REDIRECT: userCredentialUpdate,
 * passwordReset). A reset link or a new password sent to the shared test inbox
 * is useless to the person locked out, and hands their account to whoever
 * reads that inbox.
 *
 * The exception is kept narrow on purpose:
 *   · the only recipient is the account's own email address — never a
 *     reporting manager, project leader, CC list or anything typed in a form
 *   · evaluation email never comes through here; it goes through
 *     notification.queueEmail(), where the redirect still has no exceptions
 *   · "Pause all email" does not stop these, for the same reason as the
 *     redirect: a paused reset link locks the user out
 */
import prisma from '../config/database.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import { sendMail } from './graphMailer.service.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Escape a value for HTML — names and usernames are user-entered. */
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * The only address an account email may go to: the account's own.
 * Pure, for tests.
 *
 * @param {{email?: string}} user
 * @returns {string|null}
 */
export function accountRecipient(user) {
  const address = String(user?.email || '').trim().toLowerCase();
  return EMAIL.test(address) ? address : null;
}

const loginUrl = () => config.frontendUrl.replace(/\/+$/, '');

const fullName = (user) => `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username;

/** The shared PEA-branded wrapper, in the ATS account email style. */
function layout(user, inner) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="font-family:Calibri,Arial,sans-serif;font-size:14px;color:#333;line-height:1.6;">
  <div style="max-width:600px;margin:0 auto;padding:20px;border:1px solid #e8ede0;border-radius:5px;">
    <div style="background:#f7f9f6;padding:15px;text-align:center;border-bottom:2px solid #7cb342;margin-bottom:20px;">
      <h2 style="margin:0;color:#33691e;">AAPNA PEA — Evaluation Platform</h2>
    </div>
    <p>Dear ${esc(fullName(user))},</p>
    ${inner}
    <p>Best regards,<br/>HR Admin Team<br/>AAPNA Infotech</p>
    <div style="font-size:12px;color:#777;margin-top:30px;border-top:1px solid #e8ede0;padding-top:10px;">
      This is an automated notification. Please do not reply directly to this email.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Send one account email to the account's own inbox and log it. Never throws:
 * the account change has already been saved, and the caller reports the result.
 *
 * @returns {Promise<{status: 'sent'|'failed'|'skipped', to: string|null, error?: string}>}
 */
async function sendAccountEmail({ type, user, subject, html }) {
  const to = accountRecipient(user);
  if (!to) {
    logger.warn(`🔐 ${type} not sent for ${user?.username}: the account has no valid email address`);
    return { status: 'skipped', to: null, error: 'the account has no valid email address' };
  }

  let result;
  try {
    // allowRealRecipients: the account-email exception to the non-prod guard.
    await sendMail({ to: [to], subject, html, replyTo: config.microsoft.replyTo || undefined, allowRealRecipients: true });
    result = { status: 'sent', to };
    logger.info(`🔐 ${type} → ${to}${config.email.redirectInNonProd ? ' (account email — not redirected)' : ''}`);
  } catch (err) {
    result = { status: 'failed', to, error: err.message };
    logger.error(`💥 ${type} failed for ${to}: ${err.message}`);
  }

  // Logged separately: a log write failing must not turn a sent email into "failed".
  try {
    await prisma.pea_email_log.create({
      data: {
        email_type: type,
        recipient_email: to,
        subject,
        status: result.status,
        error_message: result.error || null,
      },
    });
  } catch (err) {
    logger.warn(`Could not log ${type} for ${to}: ${err.message}`);
  }

  return result;
}

/**
 * Login details after an admin creates an account or sets its password — the
 * ATS sendCredentialEmail, including the password itself.
 *
 * @param {{user: object, plainTextPassword: string, isNewUser?: boolean}} params
 */
export function sendCredentialEmail({ user, plainTextPassword, isNewUser = false }) {
  const subject = isNewUser
    ? 'Your AAPNA PEA Account Credentials'
    : 'Your AAPNA PEA Account Password Has Been Updated';
  const row = (label, value) =>
    `<div style="margin-bottom:8px;"><strong style="display:inline-block;width:120px;">${label}</strong>${value}</div>`;

  const html = layout(
    user,
    `<p>Your AAPNA PEA account ${isNewUser ? 'has been created' : 'password has been updated'} by the Administrator. Please find your login details below:</p>
    <div style="background:#f1f8e9;border:1px solid #c5e1a5;padding:15px;margin:20px 0;border-radius:4px;">
      ${row('Portal URL:', `<a href="${esc(loginUrl())}">${esc(loginUrl())}</a>`)}
      ${row('Username:', `<code>${esc(user.username)}</code>`)}
      ${row('Email:', `<code>${esc(user.email)}</code>`)}
      ${row(isNewUser ? 'Password:' : 'New Password:', `<code>${esc(plainTextPassword)}</code>`)}
    </div>
    <p>For security, sign in and change your password as soon as possible (your name at the top right → <strong>Change Password</strong>).</p>
    <p>If you did not expect this email, contact the PEA administrator immediately.</p>`
  );

  return sendAccountEmail({ type: isNewUser ? 'user_created' : 'user_password_changed', user, subject, html });
}

/**
 * The forgot-password link. Single-use, expires in 30 minutes.
 *
 * @param {{user: object, resetUrl: string}} params
 */
export function sendPasswordResetEmail({ user, resetUrl }) {
  const html = layout(
    user,
    `<p>We received a request to reset the password for your AAPNA PEA account (<code>${esc(user.username)}</code>). Click the button below to choose a new password:</p>
    <div style="background:#f1f8e9;border:1px solid #c5e1a5;padding:20px;margin:20px 0;border-radius:4px;text-align:center;">
      <a href="${esc(resetUrl)}" style="display:inline-block;background:#558b2f;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 28px;border-radius:4px;">Reset Password</a>
      <div style="word-break:break-all;font-size:12px;color:#555;margin-top:15px;">
        If the button doesn't work, copy and paste this link into your browser:<br/>
        <a href="${esc(resetUrl)}">${esc(resetUrl)}</a>
      </div>
    </div>
    <p>This link expires in <strong>30 minutes</strong> and can only be used once.</p>
    <p>If you did not request a password reset, you can safely ignore this email — your password will not change.</p>`
  );

  return sendAccountEmail({ type: 'password_reset_request', user, subject: 'Reset Your AAPNA PEA Password', html });
}
