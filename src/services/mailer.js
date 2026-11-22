'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');

/**
 * Email sender with two transports:
 *   - 'console' (default in dev): prints the email + any links to stdout so
 *     magic/renew links are easy to grab without configuring SMTP.
 *   - 'smtp': real delivery via nodemailer.
 */
let transport = null;

function getTransport() {
  if (transport) return transport;
  if (config.mail.transport === 'smtp' && config.mail.smtp.host) {
    transport = nodemailer.createTransport({
      host: config.mail.smtp.host,
      port: config.mail.smtp.port,
      secure: config.mail.smtp.secure,
      auth: config.mail.smtp.user
        ? { user: config.mail.smtp.user, pass: config.mail.smtp.pass }
        : undefined,
    });
  } else {
    // JSON transport: nodemailer formats the message; we log it ourselves.
    transport = nodemailer.createTransport({ jsonTransport: true });
  }
  return transport;
}

async function sendMail({ to, subject, text, html }) {
  const message = { from: config.mail.from, to, subject, text, html };
  const t = getTransport();

  if (config.mail.transport === 'smtp' && config.mail.smtp.host) {
    await t.sendMail(message);
    return;
  }

  // Console mode - surface the link prominently for development.
  const result = await t.sendMail(message);
  const linkMatch = String(text || '').match(/https?:\/\/\S+/);
  /* eslint-disable no-console */
  console.log('\n─────────────── EMAIL (console transport) ───────────────');
  console.log(`To:      ${to}`);
  console.log(`Subject: ${subject}`);
  console.log('---------------------------------------------------------');
  console.log(text);
  if (linkMatch) console.log(`\n>> LINK: ${linkMatch[0]}`);
  console.log('─────────────────────────────────────────────────────────\n');
  /* eslint-enable no-console */
  void result;
}

function sendMagicLink({ to, verifyUrl }) {
  return sendMail({
    to,
    subject: `Confirm your ${config.site.name} ad`,
    text: [
      `Thanks for posting on ${config.site.name}.`,
      '',
      'Click the link below to verify your email and submit your ad for review.',
      'This link expires in 60 minutes.',
      '',
      verifyUrl,
      '',
      'If you did not request this, you can safely ignore this email.',
    ].join('\n'),
  });
}

function sendRenewLink({ to, adTitle, renewUrl, manageUrl }) {
  return sendMail({
    to,
    subject: `Your ${config.site.name} ad is about to expire`,
    text: [
      `Your ad "${adTitle}" on ${config.site.name} will expire soon.`,
      '',
      'Renew it with one click to keep it visible for another',
      `${config.ad.expiryDays} days:`,
      '',
      renewUrl,
      '',
      `Manage this ad: ${manageUrl}`,
    ].join('\n'),
  });
}

function sendAdApproved({ to, adTitle, adUrl }) {
  return sendMail({
    to,
    subject: `Your ${config.site.name} ad is live`,
    text: [
      `Good news - your ad "${adTitle}" has been approved and is now live:`,
      '',
      adUrl,
      '',
      `It will run for ${config.ad.expiryDays} days.`,
    ].join('\n'),
  });
}

function sendAdRejected({ to, adTitle, reason }) {
  return sendMail({
    to,
    subject: `Your ${config.site.name} ad was not approved`,
    text: [
      `Unfortunately your ad "${adTitle}" was not approved.`,
      reason ? `\nReason: ${reason}` : '',
      '',
      'If you believe this was a mistake, please reply to this email.',
    ].join('\n'),
  });
}

/** Relay a buyer's message to the poster without revealing their address. */
function sendContactRelay({ to, adTitle, adUrl, fromName, fromEmail, body }) {
  return sendMail({
    to,
    subject: `New enquiry about "${adTitle}"`,
    text: [
      `Someone is interested in your ad "${adTitle}".`,
      '',
      `Name:  ${fromName}`,
      `Email: ${fromEmail}`,
      '',
      'Message:',
      body,
      '',
      `Ad link: ${adUrl}`,
      '',
      'Reply directly to this email to respond to the buyer.',
    ].join('\n'),
  });
}

module.exports = {
  sendMail,
  sendMagicLink,
  sendRenewLink,
  sendAdApproved,
  sendAdRejected,
  sendContactRelay,
};
