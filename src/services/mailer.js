'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');
const { t } = require('../config/i18n');

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
  const tx = getTransport();

  if (config.mail.transport === 'smtp' && config.mail.smtp.host) {
    await tx.sendMail(message);
    return;
  }

  // Console mode - surface the link prominently for development.
  const result = await tx.sendMail(message);
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
    subject: t('mail.magicSubject', { siteName: config.site.name }),
    text: [
      t('mail.magicIntro', { siteName: config.site.name }),
      '',
      t('mail.magicAction'),
      t('mail.magicExpiry'),
      '',
      verifyUrl,
      '',
      t('mail.magicIgnore'),
    ].join('\n'),
  });
}

function sendRenewLink({ to, adTitle, renewUrl, manageUrl }) {
  return sendMail({
    to,
    subject: t('mail.renewSubject', { siteName: config.site.name }),
    text: [
      t('mail.renewIntro', { adTitle, siteName: config.site.name }),
      '',
      t('mail.renewAction', { days: config.ad.expiryDays }),
      '',
      renewUrl,
      '',
      t('mail.renewManage', { manageUrl }),
    ].join('\n'),
  });
}

function sendAdApproved({ to, adTitle, adUrl }) {
  return sendMail({
    to,
    subject: t('mail.approvedSubject', { siteName: config.site.name }),
    text: [
      t('mail.approvedIntro', { adTitle }),
      '',
      adUrl,
      '',
      t('mail.approvedExpiry', { days: config.ad.expiryDays }),
    ].join('\n'),
  });
}

function sendAdRejected({ to, adTitle, reason }) {
  return sendMail({
    to,
    subject: t('mail.rejectedSubject', { siteName: config.site.name }),
    text: [
      t('mail.rejectedIntro', { adTitle }),
      reason ? `\n${t('mail.rejectedReason', { reason })}` : '',
      '',
      t('mail.rejectedReply'),
    ].join('\n'),
  });
}

/** Relay a buyer's message to the poster without revealing their address. */
function sendContactRelay({ to, adTitle, adUrl, fromName, fromEmail, body }) {
  return sendMail({
    to,
    subject: t('mail.contactSubject', { adTitle }),
    text: [
      t('mail.contactIntro', { adTitle }),
      '',
      t('mail.contactName', { name: fromName }),
      t('mail.contactEmail', { email: fromEmail }),
      '',
      t('mail.contactMessageLabel'),
      body,
      '',
      t('mail.contactAdLink', { adUrl }),
      '',
      t('mail.contactReply'),
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
