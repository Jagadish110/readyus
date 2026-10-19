# ReadyUs

Hyperlocal marketplace for food, groceries and everyday essentials.

A shop appears only when the customer is inside the shop's own delivery radius
**and** the shop is inside the radius the customer chose. Both directions must
hold — there is no wider fallback.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS v4 (CSS-first `@theme`) |
| Database | Supabase Postgres + PostGIS |
| Auth | Supabase Auth — phone OTP, Google, email + password |
| Storage | Supabase Storage |
| Realtime | Supabase Realtime |

One app serves all four audiences. Routes are grouped by role and separated by
Postgres row level security, not by separate builds.

| Area | Routes | Role |
| --- | --- | --- |
| Customer / guest | `/`, `/browse`, `/cart`, `/orders` | none / `customer` |
| Business | `/business/**` | `seller` |
| Delivery | `/delivery/**` | `delivery` |
| Admin | `/admin/**` | `admin` |

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase keys
npm run dev
```

Open http://localhost:3000. The UI renders without Supabase; sign-in and data
stay disabled until keys are present.

## Connecting Supabase

1. Create a project at supabase.com.
2. Copy **Project URL**, **anon key** and **service_role key** into `.env.local`.
3. Run the migrations in `supabase/migrations/` in order, either with the
   Supabase CLI (`supabase db push`) or by pasting each file into the SQL editor.
4. Enable the sign-in methods you want under **Authentication → Providers**:
   Phone (needs an SMS provider), Google, and Email.

## Database

Migrations are ordered and idempotent to apply in sequence.

| File | Contents |
| --- | --- |
| `0001_foundation` | Extensions, enums, role helpers |
| `0002_identity` | `profiles`, `user_roles`, `addresses`, new-user trigger |
| `0003_catalog` | `categories`, `sellers`, `products` |
| `0004_commerce` | `cart_items`, `orders`, `order_items`, `order_events`, `payments` |
| `0005_delivery` | Agents, fleets, invites, assignments |
| `0006_engagement` | Reviews, favourites, notifications |
| `0007_platform` | Platform settings, audit log, upload ledger |
| `0008_marketplace` | `nearby_sellers`, `nearby_products`, `nearby_categories` |
| `0009_rls` | Row level security for every table |
| `0010_functions` | Order lifecycle, payments, delivery, admin review |

### Money

Order and payment amounts are integers in **paise**. Nothing computes with a
formatted value. The invariant the system maintains is:

```
verified_prepaid + cash_collected + unpaid = total
```

`verified_prepaid_paise` is written only when a seller verifies a payment.
`cash_collected_paise` is written only when a delivery partner completes an
order with the customer's six-digit code. No status alone ever implies money
was received.

## Design system

Defined once in `src/app/globals.css` under `@theme`:

- **Brand** vermillion `#ff4d1c`, accent saffron `#ffb020`
- **Neutrals** warm-tinted ink, never cold grey
- **Type** Bricolage Grotesque for display, Inter for UI
- **Depth** layered warm-tinted shadows
- **Motion** spring easing for anything physical, smooth easing otherwise
