# Email (Resend)

Supabase sends Localty's sign-in emails: confirm your email, password resets, sign-in links, invites, email
changes, and a security notice when a password changes. Until it
has its own email service it delivers only to members of your Supabase team, so customers get nothing. These
steps send them through Resend from `no-reply@localty.in`, in Localty's design.

## 1. Resend: add the domain
1. resend.com > Domains > Add domain > `localty.in`.
2. Resend lists DNS records: an MX and a TXT on `send`, and a TXT on `resend._domainkey`. Add each one at
   GoDaddy, where localty.in's DNS lives: your domain > DNS > Add New Record. In the Name box type only the part
   before `.localty.in` (`send`, `resend._domainkey`); GoDaddy adds the rest. MX priority: 10.
3. Also add a TXT record named `_dmarc` with the value `v=DMARC1; p=none;`. Mail apps trust a domain with DMARC more.
4. Back in Resend, press Verify. It takes from minutes to a few hours.
5. Leave click and open tracking off for this domain: tracking rewrites links, and sign-in links then stop working.

## 1b. The logo
The emails load the logo from your Supabase Storage, because Supabase's template preview only shows images hosted
on Supabase (mail apps load it from there too). Once: Supabase > Storage > `product-images` > create the folder
`brand` > upload `public/brand/localty-logo-white.png` with that file name. Shop owners can only write inside
their own shop's folder, so they cannot replace it. If you move to a new Supabase project, upload it there too.

## 2. Keys (never paste them in a chat or a file that git tracks)
- Resend > API Keys > Create: permission "Sending access", domain `localty.in`. It is shown once.
- Supabase > Account > Access Tokens > Generate new token. Revoke it when you finish step 4.
- In the project folder create `.env.email` (git ignores it) with:
  ```
  SUPABASE_ACCESS_TOKEN=...
  RESEND_API_KEY=re_...
  ```

## 3. Send Supabase's emails through Resend (now)
```bash
node --env-file=.env.email scripts/setup-email.mjs --smtp
```
Every Supabase email then goes out through Resend as "Localty <no-reply@localty.in>", up to 100 an hour, and the
Site URL and redirect list point at https://www.localty.in. This works with the site that is live today.

## 4. Switch on the Localty designs (after the new website is live)
The new emails open `/auth/confirm`, which checks the link on the server, so it works in any browser and on any
device. Only the new website has that page, so run this once it is live:
```bash
node --env-file=.env.email scripts/setup-email.mjs --templates
```
This also switches on the "your password was changed" security notice. Then delete `.env.email` and revoke the
Supabase token.

Forgot password (the link under the password box on the login page) works as soon as the new website is live. Until
this step it uses Supabase's plain email, whose link only works in the browser that asked for it; elsewhere the
reset page says the link has expired. After this step the link works on any device.

## 5. Test
Sign up on www.localty.in with an address that is not on your Supabase team. The email arrives within a minute,
from Localty, in the green design; Confirm email signs you in on whichever phone or computer opens it. Then log
out, tap Forgot password?, and follow the reset email: it opens a page to choose a new password, and a second
email confirms the password was changed. If mail lands in spam, check that every record in Resend shows Verified.

## By hand, instead of the script
- Supabase > Authentication > Emails > SMTP Settings: host `smtp.resend.com`, port `465`, username `resend`,
  password: the Resend API key, sender `no-reply@localty.in`, sender name `Localty`.
- Authentication > Rate Limits: emails sent per hour, 100.
- Authentication > URL Configuration: Site URL `https://www.localty.in`, and add `https://www.localty.in/**`.
- After the new site is live, Authentication > Emails > Templates: paste each file in `supabase/templates/`.
  Subjects: Confirm your email for Localty, Reset your Localty password, Your Localty sign-in link, You're invited
  to Localty, Confirm your new email address. Under security notifications, switch on "Password changed" and paste
  `password_changed_notification.html` with the subject Your Localty password was changed.

To use the Localty designs before the new site is live, add `--supabase-links` (to `--templates` or `--write`):
the same emails with Supabase's own link, which works with today's site but only in the browser that asked for
the email. Switch to the normal templates once the new site is live.

To change a design, edit `scripts/setup-email.mjs`, run it with `--write supabase/templates` to refresh the files,
and `--preview <folder>` to see them filled in.

## Limits
Resend's free plan sends 100 emails a day and 3,000 a month; the paid plan raises that when sign-ups grow.
