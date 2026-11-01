#!/usr/bin/env node
/**
 * Localty's sign-in emails on Supabase: sent through Resend, in Localty's design. See docs/EMAIL.md.
 *
 *   node --env-file=.env.email scripts/setup-email.mjs --smtp        send Supabase's emails through Resend
 *   node --env-file=.env.email scripts/setup-email.mjs --templates   switch to the Localty templates (their links
 *                                                                    open /auth/confirm, so the website with that
 *                                                                    page must be live first)
 *   node scripts/setup-email.mjs --write supabase/templates          write the templates, to paste by hand
 *   node scripts/setup-email.mjs --preview <folder>                  write them filled in with sample values
 *
 * Add --supabase-links to any of these to use Supabase's own link ({{ .ConfirmationURL }}) instead of
 * /auth/confirm: the same design, working with the website that is live today, but only in the browser that
 * asked for the email. Run again without it once the new website is live.
 *
 * .env.email (git ignores every .env file except .env.example) holds:
 *   SUPABASE_ACCESS_TOKEN  supabase.com/dashboard/account/tokens; revoke it when done
 *   RESEND_API_KEY         resend.com/api-keys, "Sending access" is enough; only --smtp needs it
 * Optional: EMAIL_FROM (default no-reply@localty.in, on a domain verified in Resend), SITE_URL (default
 * https://www.localty.in), SUPABASE_PROJECT_REF (default: read from NEXT_PUBLIC_SUPABASE_URL in .env.local).
 * The secrets go to Supabase only and are never printed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = (process.env.SITE_URL ?? 'https://www.localty.in').replace(/\/$/, '');
const FROM = process.env.EMAIL_FROM ?? 'no-reply@localty.in';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// The logo is served from the project's own storage (product-images/brand/, upload it once, see docs/EMAIL.md):
// mail apps load it, and so does Supabase's template preview, which only shows images hosted on Supabase.
const LOGO =
  process.env.EMAIL_LOGO_URL ??
  (findProjectRef()
    ? `https://${findProjectRef()}.supabase.co/storage/v1/object/public/product-images/brand/localty-logo-white.png`
    : `${SITE}/brand/localty-logo-white.png`);

const args = process.argv.slice(2);
const SUPABASE_LINKS = args.includes('--supabase-links');

/** Every link opens /auth/confirm on the website, which checks the one-time token on the server. */
const link = (type, next = '{{ .RedirectTo }}') =>
  SUPABASE_LINKS
    ? '{{ .ConfirmationURL }}'
    : `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${type}&amp;next=${next}`;

// Keys match Supabase's names: mailer_subjects_<key> and mailer_templates_<key>_content.
const TEMPLATES = {
  confirmation: {
    subject: 'Confirm your email for Localty',
    preheader: 'One tap to finish setting up your Localty account.',
    heading: 'Confirm your email',
    body: 'Tap the button to confirm <strong>{{ .Email }}</strong> and finish setting up your Localty account.',
    button: 'Confirm email',
    href: link('email'),
    reason: "This address was used to sign up on Localty. If that wasn't you, ignore this email and nothing will change."
  },
  magic_link: {
    subject: 'Your Localty sign-in link',
    preheader: 'Tap to sign in to Localty.',
    heading: 'Sign in to Localty',
    body: 'Tap the button to sign in. The link works once.',
    button: 'Sign in',
    href: link('email'),
    reason: "Someone asked to sign in to Localty with this address. If that wasn't you, ignore this email and nothing will change."
  },
  invite: {
    subject: "You're invited to Localty",
    preheader: 'Accept your invite to Localty.',
    heading: "You're invited",
    body: 'You have been invited to Localty. Tap the button to accept and open your account.',
    button: 'Accept invite',
    href: link('invite'),
    reason: "A Localty admin invited this address. If you weren't expecting it, you can ignore this email."
  },
  email_change: {
    subject: 'Confirm your new email address',
    preheader: 'Confirm the new email for your Localty account.',
    heading: 'Confirm your new email',
    body: 'Tap the button to use <strong>{{ .NewEmail }}</strong> for your Localty account instead of {{ .Email }}.',
    button: 'Confirm new email',
    href: link('email_change', '/account'),
    reason: "Someone asked to change the email address on a Localty account. If that wasn't you, ignore this email and nothing will change."
  },
  recovery: {
    subject: 'Reset your Localty password',
    preheader: 'Choose a new password for your Localty account.',
    heading: 'Choose a new password',
    body: 'Tap the button to choose a new password for <strong>{{ .Email }}</strong>. The link works once.',
    button: 'Choose new password',
    // A fixed page, not RedirectTo: the person must land where the new password is typed.
    href: link('recovery', '/reset-password'),
    reason: "Someone asked to reset the password for this address on Localty. If that wasn't you, ignore this email and your password stays the same."
  },
  // A security notice, switched on with the templates (mailer_notifications_password_changed_enabled).
  password_changed_notification: {
    subject: 'Your Localty password was changed',
    preheader: 'A security notice about your Localty account.',
    heading: 'Your password was changed',
    body: "The password for <strong>{{ .Email }}</strong> was just changed. If that was you, there's nothing more to do. If it wasn't, reset it now so only you can log in.",
    button: 'Reset my password',
    href: '{{ .SiteURL }}/forgot-password',
    reason: 'This is a security notice for your Localty account.'
  }
};

/**
 * One email. Tables and inline styles, because that is what mail apps render reliably; one image (the logo,
 * with readable alt text when images are off) and no marketing, which keeps sign-in mail out of spam folders.
 * The button colour is brand-600 with large text, so its label meets contrast rules.
 */
function render(t) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${t.subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4efec;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${t.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4efec;">
<tr>
<td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="520" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:24px;overflow:hidden;">
<tr>
<td style="background-color:#246540;padding:22px 28px;">
<img src="${LOGO}" width="103" height="36" alt="Localty" style="display:block;border:0;width:103px;height:36px;font-family:${FONT};font-size:22px;font-weight:700;color:#ffffff;">
</td>
</tr>
<tr>
<td style="padding:32px 28px 8px;font-family:${FONT};">
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:800;color:#1c1614;">${t.heading}</h1>
<p style="margin:0;font-size:16px;line-height:1.55;color:#342c28;">${t.body}</p>
</td>
</tr>
<tr>
<td style="padding:24px 28px 8px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td align="center" bgcolor="#e63a0b" style="border-radius:999px;">
<a href="${t.href}" target="_blank" style="display:inline-block;padding:15px 32px;font-family:${FONT};font-size:19px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:999px;">${t.button}</a>
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td style="padding:20px 28px 32px;font-family:${FONT};">
<p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#7a6e68;">Button not working? Copy this link into your browser:</p>
<p style="margin:0;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${t.href}" target="_blank" style="color:#bf2e08;text-decoration:underline;">${t.href}</a></p>
</td>
</tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr>
<td style="padding:20px 28px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#7a6e68;text-align:center;">
${t.reason}<br>
<a href="${SITE}" target="_blank" style="color:#7a6e68;">Localty</a>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>
`;
}

const SAMPLE = {
  '{{ .SiteURL }}': SITE,
  '{{ .ConfirmationURL }}': `https://project.supabase.co/auth/v1/verify?token=pkce_0f1e2d3c&type=signup&redirect_to=${SITE}/auth/callback`,
  '{{ .TokenHash }}': 'pkce_0f1e2d3c4b5a69788796a5b4c3d2e1f0',
  '{{ .RedirectTo }}': `${SITE}/auth/callback?next=%2Fbrowse`,
  '{{ .Email }}': 'you@example.com',
  '{{ .NewEmail }}': 'new@example.com'
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

function findProjectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  const fromFile = existsSync('.env.local')
    ? /^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m.exec(readFileSync('.env.local', 'utf8'))?.[1]
    : undefined;
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? fromFile ?? '').trim().replace(/^["']|["']$/g, '');
  return /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1];
}

function projectRef() {
  const ref = findProjectRef();
  if (!ref) fail('Set SUPABASE_PROJECT_REF: the id in your Supabase dashboard address.');
  return ref;
}

async function api(token, method, path, body) {
  const response = await fetch(`https://api.supabase.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  if (!response.ok) fail(`Supabase said ${response.status} to ${method} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const option = (name) => (args.includes(name) ? (args[args.indexOf(name) + 1] ?? '') : undefined);

// ---------- Write the templates to files ----------

const folder = option('--write') ?? option('--preview');
if (folder !== undefined) {
  if (!folder) fail('Give a folder, e.g. --write supabase/templates');
  mkdirSync(folder, { recursive: true });
  for (const [name, template] of Object.entries(TEMPLATES)) {
    let html = render(template);
    if (option('--preview') !== undefined) {
      for (const [placeholder, value] of Object.entries(SAMPLE)) html = html.split(placeholder).join(value);
    }
    writeFileSync(join(folder, `${name}.html`), html);
    console.log(`${join(folder, `${name}.html`)}   subject: ${template.subject}`);
  }
  process.exit(0);
}

// ---------- Update the Supabase project ----------

const smtp = args.includes('--smtp');
const templates = args.includes('--templates');
if (!smtp && !templates) fail('Say what to set up: --smtp, --templates, or both. See the top of scripts/setup-email.mjs.');

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) fail('SUPABASE_ACCESS_TOKEN is missing. Put it in .env.email and run with --env-file=.env.email.');
const ref = projectRef();
const current = await api(token, 'GET', `/projects/${ref}/config/auth`);
const update = {};

if (smtp) {
  const key = process.env.RESEND_API_KEY ?? '';
  if (!key.startsWith('re_')) fail('RESEND_API_KEY is missing or is not a Resend key (those start with re_).');
  Object.assign(update, {
    smtp_host: 'smtp.resend.com',
    smtp_port: '465',
    smtp_user: 'resend',
    smtp_pass: key,
    smtp_admin_email: FROM,
    smtp_sender_name: 'Localty',
    // Supabase drops to 30 emails an hour when custom SMTP is switched on. Resend's free plan sends 100 a day.
    rate_limit_email_sent: Math.max(Number(current.rate_limit_email_sent) || 0, 100)
  });
}

if (templates) {
  for (const [name, template] of Object.entries(TEMPLATES)) {
    update[`mailer_subjects_${name}`] = template.subject;
    update[`mailer_templates_${name}_content`] = render(template);
  }
  update.mailer_notifications_password_changed_enabled = true;
}

// The links in the emails start with the Site URL, and sign-up asks to come back to this site.
if (current.site_url !== SITE) update.site_url = SITE;
const allowed = String(current.uri_allow_list ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
if (!allowed.includes(`${SITE}/**`)) update.uri_allow_list = [...allowed, `${SITE}/**`].join(',');

await api(token, 'PATCH', `/projects/${ref}/config/auth`, update);
const after = await api(token, 'GET', `/projects/${ref}/config/auth`);

console.log(`Supabase project ${ref}:`);
if (smtp) {
  const ok = after.smtp_host === 'smtp.resend.com' && after.smtp_admin_email === FROM;
  console.log(`  ${ok ? 'ok ' : 'NOT SET'} emails go through Resend, from Localty <${FROM}>`);
  console.log(`  ok  up to ${after.rate_limit_email_sent} emails an hour`);
}
if (templates) {
  for (const [name, template] of Object.entries(TEMPLATES)) {
    const ok = after[`mailer_subjects_${name}`] === template.subject;
    console.log(`  ${ok ? 'ok ' : 'NOT SET'} ${name} template: "${template.subject}"`);
  }
}
if (update.site_url) console.log(`  ok  Site URL changed to ${SITE} (was ${current.site_url || 'empty'})`);
if (update.uri_allow_list) console.log(`  ok  ${SITE}/** added to the redirect allow list`);
if (after.mailer_autoconfirm) {
  console.log('  note: "Confirm email" is OFF, so new accounts work without confirming and no sign-up email is sent.');
}
