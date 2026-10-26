# UX review: customer and shop owner

Method: the website, backend and a sample database were run locally and every main screen was
captured on a 390 px phone (the width most customers and many shop owners will use), signed in as a
customer and as a shop owner, then the code behind the weak spots was read. Not done: real devices,
slow networks, screen readers, Telugu or Hindi text, or any test with real users.

## Fixed in this pass

| Side | Problem | Fix |
| --- | --- | --- |
| Owner | The whole console was 518 px wide on a 390 px phone, so the page scrolled sideways (the five tabs did not fit) | Tabs get their own row and fit; page width now equals the screen |
| Owner | Orders page said "must be accepted within five minutes", which has not been true for cash orders since migration 0020 | Honest copy: paid-online orders are refunded if not accepted in time |
| Owner | An order that had not been paid yet was labelled "Paid online" | Label follows the money: Cash on delivery / Online payment pending / Part paid (collect cash) / Paid online |
| Owner | Declining an order opened a browser `prompt()` box | One-tap reasons ("An item is sold out", "We are too busy"...) |
| Owner | No sense of how long an order had waited | "Waiting 6 min", plus the refund countdown for paid orders |
| Owner | A new order was easy to miss | Tab title shows the count; optional chime for new orders |
| Owner | Product list used a 350 px card per dish | Compact rows: photo, name, price, stock switch |
| Owner | Price and MRP boxes on the product form sat at different heights | Aligned |
| Customer | On a phone the main button ("Explore nearby shops") was below the first screen | Moved under the headline |
| Customer | Header showed "Abids, H..." squeezed next to the radius chip | Shows the place name; full text on hover |
| Customer | Header was see-through and page text showed behind it | More opaque |
| Customer | Nothing told you your basket was filling while browsing | Floating "2 items · Rs 840 · View cart" bar on phones |
| Customer | Every dish on a shop's own page repeated the shop name and distance | Hidden there |
| Customer | Cart said "Delivery: calculated at checkout" and "Commission: Zero, always" (a shop-side idea), checkout said "Free" | Cart says Delivery Free, Platform fee Rs 0 |
| Customer | Shop pages showed "Rs 25 delivery" or "Free over Rs 499" although `place_order()` never charges delivery | Always "Free delivery" (the truth) |
| Customer | "Place order" was at the bottom of a long form | Sticky bar with the total and the button on phones |
| Customer | Confusing line about shops that "ask for UPI even if you pick cash" | Plain wording |

## Found, not fixed (in rough priority order)

1. **Shop owner has no photo help.** Dishes without a photo show a letter in a box, and the customer
   app then shows a stock photo of a different dish. Customers distrust that. Make a photo required
   (or strongly nudged) before a dish goes live.
2. **Owner dashboard leads with product counts**, not what a restaurant needs at 7 pm: orders waiting,
   today's orders and cash. Put "N orders need you" first and link straight to the board.
3. **Customers cannot call the shop** from the order page, and there is no "something is wrong"
   route. Add shop phone and a help link (and show the rider's phone once assigned, if not already).
4. **The home page is about 10,700 px long on a phone.** Cut it to hero, how it works, a few shops,
   and the shop-owner pitch.
5. **No language options.** The first customers are in Hyderabad: Telugu, Hindi and Urdu for the
   owner console especially. Strings are inline in components, so this needs an i18n pass.
6. **Owner onboarding is a pile of cards.** Show one checklist: details, documents, approval,
   bank, plan, first dish, go live.
7. **Accessibility not audited.** Check colour contrast on the muted grey text, focus outlines,
   touch targets under 44 px (the quantity +/- buttons are 32 px), and the order tracker for screen readers.
8. **Running the website without Supabase keys returns an error page**, although the README says the UI
   renders without them. Either fix the claim or the behaviour.
9. **Order tracker has no "your shop is slow" state.** Cash orders can wait forever (by design).
   Consider a nudge to the shop after N minutes and a way for the customer to cancel with one tap.
10. **Empty and error states** are mostly good; read each once with real copy before launch.

## How to look at it yourself

`backend/test/db/supabase-shim.sql` plus `supabase/migrations` and `supabase/seed.sql` build a database
with five demo shops. The screens above were captured with a stand-in login server so no Supabase
account was needed; that stand-in is not part of the repository.
