# Testing the full workflow, step by step

You will play four people: **admin**, **shop owner**, **delivery partner (rider)** and **customer**.
Use four different email addresses (or four browser profiles / private windows), because the sessions
must not overwrite each other.

## 0. One-time setup

1. **Supabase project** (supabase.com). Run every file in `supabase/migrations/` in order
   (`0001` ... `0027`), or `supabase db push`. Optional: run `supabase/seed.sql` for five demo shops.
2. **Supabase Auth settings.** Authentication -> Providers -> Email: for testing, turn **off**
   "Confirm email" so sign-up logs you straight in.
3. **Cashfree sandbox account** (merchant.cashfree.com, "Test" mode). Ask Cashfree to enable
   **Easy Split** (online payments with money going straight to shops) and **Subscriptions** (the
   shop's monthly fee). Copy the sandbox App ID and Secret Key.
4. **Backend:** `cd backend && cp .env.example .env`, fill it in (Supabase URL, service role key,
   `DATABASE_URL` from Supabase -> Connect -> Transaction pooler, the Cashfree keys with
   `CASHFREE_ENV=sandbox`, `CRON_SECRET`, `SITE_URL=http://localhost:3000`), then `npm install && npm run dev`
   (port 4000).
5. **Website:** `cp .env.example .env.local` in the repo root, set `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL=http://localhost:4000`, then `npm install && npm run dev`
   (port 3000). A Google Maps key is optional; without it the live map is replaced by an "Open in Google Maps" link.
6. **Webhooks (optional but realistic).** Cashfree cannot reach `localhost`. Run a tunnel
   (`cloudflared tunnel --url http://localhost:4000` or ngrok), put the https address in `PUBLIC_API_URL`,
   and in the Cashfree dashboard -> Developers -> Webhooks add `https://<tunnel>/v1/webhooks/cashfree`
   with the payment-success and subscription events. **Without it everything still works**: the website
   asks the backend to re-check with Cashfree when the payment window closes.
7. **Make yourself admin** (once), in the Supabase SQL editor, after signing up with the admin email:
   ```sql
   insert into user_roles (user_id, role)
   select id, 'admin' from profiles where email = 'admin@example.com' on conflict do nothing;
   ```

## 1. Shop owner: get a shop live

1. Sign up at `/sign-up` with the owner email. Open `/business/apply`.
2. Fill the two steps (shop details, pin the shop on the map, delivery radius). Submit.
   **Check:** the page says the application is waiting for review.
3. Sign in as **admin**, open `/admin/approvals`, approve the shop.
   **Check:** the owner's `/business` now says "Approved". A 30-day free trial starts automatically:
   `/business/billing` shows "30 days of free trial left".
4. Owner: `/business/products/new`. Add 2-3 dishes with price, a photo, in stock. Products go live on save
   (migration 0013).
5. Owner: `/business` -> toggle "Taking orders" on, set the delivery radius and opening hours -> Save.

## 2. Shop owner: bank details (needed for online payments)

See section 7 for exactly what is checked. To test:

1. `/business/payouts` -> "Add bank details".
2. Enter: business type, your name, a PAN (format `ABCDE1234F`), account holder name, account number
   (typed twice), IFSC.
   In sandbox, Cashfree's bank-check test accounts are (account / IFSC): `00011020001772` / `HDFC0000001`
   succeeds; `000100289877623` / `SBIN0008752` fails at the bank; `2640101002729` / `CNRR0002640` invalid IFSC;
   `026291800001190` / `YESB0000262` invalid account.
   (These come from Cashfree's bank-verification test data. Whether Easy Split accepts the same numbers in
   your sandbox account is the first thing to confirm; if not, ask Cashfree support for vendor test data.)
3. **Check:** the badge moves "Being verified" -> "Ready for payouts". If it shows "More details needed",
   the line "Cashfree says: ..." tells the owner what to fix; fix and save again.
4. Until it says "Ready for payouts", customers of this shop can only choose cash on delivery.

## 3. Customer: browse, order (cash)

1. In a private window sign up the customer. Open `/browse`, choose "Use my current location" (or a sample
   area). **Check:** only shops whose delivery radius covers you appear, within your chosen km.
2. Open the shop, tap ADD on two dishes. **Check:** the green "2 items · View cart" bar appears.
3. Cart -> Proceed to checkout. Add an address with a **10-digit phone** (needed for online payment later).
   Choose **Cash on delivery** -> Place order.
4. **Check:** `/orders/<id>` shows "Waiting for the shop" and a Cancel button.

## 4. Owner: accept and prepare

1. Owner: `/business/orders` (open on a phone-size window too). **Check:** the new order is under
   "Needs your decision" with "Waiting N min". Turn on the sound alert and place a second order to hear it.
2. Tap **Accept**. Customer page updates to "Accepted" (the page refreshes by itself).
3. **Start preparing**, then **Mark ready for pickup**.
4. **Check:** the order moves to "Ready: choose who delivers".
   With no riders on your team it says "You have no riders on your team yet." Do section 5 next.

## 5. Rider: join the shop's team

The delivery partner has their **own door**: `/delivery/login`.

1. Owner: on the Orders page, "Your delivery team" -> **New rider code**. Copy the 6-letter code.
2. Rider (another window): open `/delivery/login` -> Create account (`mode=sign-up`) -> after sign-up you land
   on `/delivery/apply`. Enter name, phone, vehicle -> **Create delivery profile**.
3. Rider dashboard `/delivery` shows "Join a shop's team". Enter the code -> **Join team**.
   **Check:** it now says "Delivering for <shop>" and "No delivery assigned to you right now".
   The owner's team list now shows the rider. A code works once.

## 6. Owner assigns, rider delivers, customer follows

1. Owner: on the ready order choose the rider in the dropdown -> **Assign rider**.
   **Check:** the card moves to "Out for delivery": "<rider> has been told and is coming to collect it", with a
   "Call" link and "Change rider".
2. Customer: the order page shows "Rider assigned" with the rider's name.
3. Rider: `/delivery` (refreshes by itself) now shows the order: shop and address, customer address, "Call shop",
   "Call customer", cash to collect (or "Already paid online"), "Navigate in Google Maps".
   Allow browser location when asked: the customer sees the rider's position every 10 s.
4. Rider taps **I have picked it up**. Customer sees "On the way". Owner's card says on the way to the customer.
5. At the door the customer reads the **6-digit code** from their order page. Rider types it -> **Complete delivery**.
   **Check:** a wrong code is refused; five wrong codes lock completion for 15 minutes.
6. **Check final state:** customer sees Delivered and can leave a review; owner sees it under Recent; rider sees it under
   "Recently delivered".
7. Optional: before step 4, use "Change rider" to hand it to another rider; the first rider's list empties and they
   get a notification. After pickup the shop can no longer change it.

## 7. How the owner's bank details are verified

What happens when the owner presses Save on `/business/payouts` (code: `backend/src/routes/seller.ts`):

1. **Only an approved shop can add bank details.** An unapproved shop is refused.
2. **Format checks on our server:** PAN `AAAAA9999A`, IFSC `AAAA0XXXXXX`, account number 9-18 digits, names 2+ letters.
   Anything malformed is rejected with a plain message before anything is sent.
3. **Cashfree creates the shop as an Easy Split "vendor"**: shop id, owner name, email, phone, PAN, account type,
   business category and the bank account (holder name, number, IFSC), with `verify_account: true`
   (set `CASHFREE_VERIFY_VENDOR_BANK=false` to skip; Cashfree charges a small fee per check).
4. **Cashfree does the actual verification.** In production it checks the account exists and the details match
   by sending a Rs 1 "penny drop" to the account, and reviews the KYC (PAN). In sandbox no money moves; results
   follow Cashfree's test data.
5. **Status comes back to the owner's page**, which asks Cashfree every 5 seconds while it is pending:

   | Cashfree status | Owner sees |
   | --- | --- |
   | `IN_BANK_VALIDATION`, `IN_BENE_CREATION`, `IN_KYC_REVIEW`, `IN_REVIEW` | Being verified |
   | `BANK_VALIDATION_FAILED`, `BENE_CREATION_FAILED`, `ACTION_REQUIRED`, `ON_HOLD` | More details needed + Cashfree's reason |
   | `ACTIVE` | Ready for payouts |
   | `REJECTED`, `BLOCKED`, `DELETED` | Not approved |

6. **Only `ACTIVE` lets customers pay online** for that shop. Otherwise checkout returns "This shop cannot take
   online payments yet" and cash on delivery still works.
7. **What we store:** the last 4 digits, IFSC, holder name and status. The full account number and PAN go to
   Cashfree and are never stored or logged by Localty.
8. **Money then flows:** customer pays at Cashfree, the shop's share is split to its vendor and settled to its bank
   (Cashfree's cycle is typically T+2). Localty never holds it.

**What is not verified by Localty itself (gaps):** nobody compares the bank holder name with the PAN or owner
name; no documents (FSSAI licence, GSTIN, shop licence) are collected; changing bank details does not reset the
shop to "being verified" on our side until Cashfree says so. These are listed in `docs/REMAINING-FEATURES.md`.

## 8. Online payment test (sandbox)

1. Make sure the shop's payout status is "Ready for payouts" (section 2).
2. Customer: checkout -> **Pay online** -> Place order -> the Cashfree window opens.
3. Pay with a sandbox card: Visa `4444333322221111` (or `4706131211212123`), expiry `03/2028`, CVV `123`,
   name `Test`, OTP `111000`. (Cashfree's sandbox UPI/net-banking pages have their own "success" and "failure"
   buttons.)
4. **Check:** the order says payment confirmed; the owner's card says "Paid online" with a countdown "accept within N
   min or it is refunded". Accept it and continue from section 4. The rider sees "Already paid online. Collect no cash."
5. **Refund path:** place another online order, have the owner **Decline** it, then run the refund job once:
   `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:4000/internal/refunds/sweep`
   **Check:** the response says `refunded: 1` and the Payouts page shows it refunded.
6. **Ignored order path:** place an online order and do nothing as owner; after the deadline run
   `POST /internal/orders/expire` then `/internal/refunds/sweep`; the order ends "Shop did not respond" and is refunded.

## 9. Subscription test (sandbox)

1. Owner: `/business/billing` -> **Set up automatic payment** -> approve in Cashfree's window (sandbox UPI/card).
2. **Check:** "Automatic payment: On"; the first charge date is the day the trial ends.
3. To see the lapse behaviour without waiting a month, in SQL:
   `update subscriptions set trial_ends_at = now() - interval '10 days' where seller_id = '<shop id>';`
   **Check:** the shop disappears from `/browse`, the owner sees the red banner, and checkout for that shop says it is
   not taking orders. Orders already placed can still be completed. Set `trial_ends_at` back to the future to undo.

## 10. Automated checks (run these before every release)

```bash
cd backend && npm test                                  # unit tests
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/localty_test npm test   # + database workflow tests
cd .. && npm run lint && npx tsc --noEmit && npm run build
```
`backend/test/workflow.db.test.ts` replays sections 3-6 (order, accept, prepare, assign, pickup, delivery with the code,
reassignment, and every refusal rule) against a real Postgres.
