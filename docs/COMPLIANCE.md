# KYC and compliance documents: what we ask shop owners for, and why

**This is an engineering explanation, not legal or tax advice.** The rules below come from public
guides and government circulars found while building this. Several change often (FSSAI turnover limits
changed in 2026). Have a chartered accountant and a lawyer confirm everything in section 4 before launch.

## 1. What a shop owner gives us today

| Document / detail | Required? | Where | Who checks it |
| --- | --- | --- | --- |
| **FSSAI licence or registration**: 14-digit number, expiry date, certificate file | **Food shops: required.** Everyday-item shops: only if they sell any food | `/business/documents` | Our admin, by eye |
| **GSTIN** (15 characters) and certificate | Optional for now | `/business/documents` | Format and check character are verified by the server; an admin reviews the file |
| **PAN** | Required to receive online payments | `/business/payouts` | Cashfree (payment partner) |
| **Bank account** (holder name, number, IFSC) | Required to receive online payments | `/business/payouts` | Cashfree: bank check, plus a Rs 1 test deposit in production |
| Shop name, owner name, phone, address, map pin, delivery radius | Required | Application form | Our admin |

Deliberately **not** collected: Aadhaar (privacy rules make storing it a liability and PAN plus the bank check
is enough), shop photos of premises, municipal trade licence. These can be added later (see section 5).

## 2. Why each one

### FSSAI licence or registration (the one we enforce hardest)
- **The law:** every business that makes, stores, sells or delivers food in India must hold an FSSAI
  registration or licence (the kind depends on size and activity; the 14-digit number looks the same).
- **The platform's duty:** FSSAI's e-commerce rules make the platform responsible for showing the licence number of
  every food seller listed and for not onboarding unlicensed ones. If a customer is harmed by food from an unlicensed
  home kitchen we listed, "we did not check" is a very weak position.
- **Customer trust:** the number is printed on the shop page ("FSSAI Lic. No. ...") so customers can verify it
  on FSSAI's own site.
- **What we do with it in Localty:**
  1. A **food shop cannot be approved** until an admin has approved an FSSAI document that has not expired.
  2. Customers see the number on the shop page; nothing else from the file is public.
  3. The licence has an **expiry**. We remind the owner 30, 7 and 1 days before; once it expires the shop is
     **hidden and takes no new orders** until the renewal is approved. Orders already placed carry on.
  4. Shops that were live before this rule existed have **30 days** to add it (`sellers.documents_due_at`).
  5. We do not decide whether the owner holds the *right type* (registration, state, central). FSSAI's turnover
     limits changed from 1 April 2026 (secondary sources: registration up to Rs 1.5 crore, state licence up to
     Rs 50 crore, central above), so the admin only checks that the document is genuine, current and in the shop owner's
     (or the business's) name.
- **Admin checklist** (shown on the review screen): name on the certificate matches the shop or owner; the typed
  number matches the file; the expiry date is in the future; for a home kitchen, the premises address is plausible.
  For extra assurance an admin can look the number up on FSSAI's FoSCoS public search. We do not call it automatically
  (no stable public API is documented).

### GSTIN (optional for now, and it matters more than it looks)
- **Restaurants and food:** since 1 January 2022 GST on restaurant services supplied *through an e-commerce
  operator* is paid by the **operator**, not the restaurant (Section 9(5) CGST; CBIC Circular 167/2021, reported at 5%).
  The restaurant itself can stay unregistered for those supplies even above the normal threshold.
- **Goods (kirana, groceries, packaged items):** a person supplying goods through an e-commerce operator must normally
  register for GST whatever their turnover (Section 24(ix)), except small *intra-state* suppliers who can use an
  enrolment under Notification 34/2023-CT (conditions apply: below the threshold, one state, PAN-linked enrolment).
  The operator also collects tax at source (TCS) on goods sold through it (Section 52).
- **Why we want the number anyway:** it identifies the supplier on invoices and in the platform's own GST filings,
  and an everyday-items shop may be legally required to hold it. We keep it optional until your accountant decides the rule.
- **What we do:** the server verifies the 15-character format *and* the check character, so most typos are caught
  immediately; an admin reviews the certificate. Nothing is hidden or blocked for lack of a GSTIN today.

### PAN (collected by Cashfree through the Payouts page)
- **Payment partner KYC:** Cashfree must identify every vendor it settles money to.
- **TDS under Section 194-O (Income-tax Act):** an e-commerce operator must deduct tax, **0.1%** since 1 October 2024,
  on the gross value of sales its participants make through the platform. Resident individuals and HUFs are
  exempt below Rs 5 lakh a year *if PAN or Aadhaar is furnished*; without it the rate is 5%. This is why PAN is
  collected. (From 1 April 2026 the Income-tax Act, 2025 applies; section numbers moved, the obligation did not.)
  **We do not deduct TDS today**: see section 4.

### Bank account
- Pay the right person and prevent fraud. Cashfree sends Rs 1 to confirm the account exists and belongs to the holder name given.
  We store only the last four digits.

## 3. What happens to the files
- Stored in a **private** bucket (`seller-documents`), in a folder named after the shop. Nobody can open a link without the
  server creating a signed one; admin links last 5 minutes, and only an admin request creates them.
- The owner can see their own document's number, expiry and status, never anyone else's.
- Every submit and every review is written to `audit_logs`. A changed document goes back to "under review".
- Customers can see only: the FSSAI number, and only while the document is approved and not expired.
- Delete on request: not built yet (needed for the DPDP Act: see `docs/REMAINING-FEATURES.md`).

## 4. Questions only your CA and lawyer can answer (these can change the business model)

1. **Is Localty an "e-commerce operator" for restaurant services under Section 9(5)?** If so, Localty must register for
   GST (platforms register whatever their turnover) and **pay GST, reported at 5%, on every restaurant order**, which would
   cost far more than the shop's monthly fee and break the "no commission, no fees" economics. Whether a platform that
   only lists shops and passes the customer's money straight to the shop qualifies depends on exactly what Localty does
   (taking the order, collecting payment, controlling delivery). Get a written opinion **before launch**.
2. **TCS (Section 52) on goods sold through Localty:** is it collected, at what current rate, and by whom, given payments
   go straight to the shop through Cashfree Easy Split?
3. **TDS (Section 194-O):** who deducts and deposits it when Cashfree splits the payment? Does the customer's payment pass
   through Localty's merchant account for tax purposes? Need a process, a TAN, and quarterly returns.
4. **GST on Localty's own fee:** the monthly subscription is a taxable service (commonly 18%). Localty needs its own
   GST registration, GST invoices for every charge, and ideally the shop's GSTIN on them (that is another reason to
   collect it). The price in `subscription_plans` is currently shown "+ GST".
5. **Marketplace rules:** the Consumer Protection (E-Commerce) Rules, 2020 impose duties on marketplaces (seller details
   on the listing, a grievance officer, return and refund policies). We did not research these. Ask the lawyer.
6. **Does Localty itself need an FSSAI registration** as an e-commerce food business operator? Ask.
7. **Data protection (DPDP Act):** privacy notice, consent for location, retention of documents, deletion on request.

## 5. Easy extensions, when you want them
- **Shop licence / trade licence / Udyam:** add a `kind` to `seller_documents` (one line in the check constraint and one card
  on `/business/documents`).
- **Name match:** compare the certificate's business name and the bank holder name at review time (a field on the review screen).
- **Hygiene rating** or premises photos for food shops.
- **Automatic FSSAI lookup** if FSSAI publishes a stable API.
- **GSTIN required** for items shops once your accountant decides.

## 6. The subscription invoice is Localty's job, not Cashfree's

A shop that pays the monthly fee is buying a service from Localty, so **Localty must give it a GST tax invoice**. Cashfree Subscriptions
only moves the money: it creates the mandate, sends the customer the pre-debit notice that UPI AutoPay requires, debits on the due date and
reports the result. Cashfree's own invoices (Dashboard -> Profile -> Invoices, raised around the 5th of the next month) bill **Localty** for
Cashfree's fees; they are not Localty's invoices to shops, and they do not carry the shop's name or GSTIN. Nothing in Cashfree's documentation
says it generates a tax invoice for the merchant's customers.

What an invoice must show (confirm the exact list with your CA): Localty's legal name, address and GSTIN; the shop's name, address and
GSTIN if it has one; a unique running number within the financial year; the date; a description of the service; the service accounting code; the
value, then GST split into CGST and SGST (shop in the same state as Localty) or IGST (different state), and the total; the place of supply.

What we have today: `subscription_payments` records every successful charge (amount, date, period). What is missing: Localty's own
business details, invoice numbering, the invoice record created in the same transaction as the payment, a printable copy, and a page for
the owner to download them. To build it we need from you: Localty's registered legal name, address, state and GSTIN; the service code
and GST rate your CA confirms; and whether the Rs 499 price includes or excludes GST (the app currently says "+ GST").

## Sources
- FSSAI display and registration rules for e-commerce food sellers: [ClearTax](https://cleartax.in/s/e-commerce-fssai-food-license-registration),
  [Tally Solutions guide](https://tallysolutions.com/business-guides/fssai-licence-requirements-for-manufacturers-restaurants-traders-e-commerce-more/),
  [Vikaspedia](https://vikaspedia.in/e-governance/online-citizen-services/government-to-business-services-g2b/fssai-food-license-online-registration)
  (secondary sources; verify against FSSAI / FoSCoS).
- GST on restaurant services through e-commerce operators: [CBIC Circular 167/2021](https://www.gstcouncil.gov.in/sites/default/files/2024-06/circular-167-2021-gst.pdf),
  [ClearTax explainer](https://cleartax.in/s/gst-on-notified-services-ecommerce-operators-95), [TaxGuru](https://taxguru.in/goods-and-service-tax/supply-restaurant-services-e-commerce-operator.html).
- GST registration for goods sellers on platforms: [Taxmann](https://taxmann.com/post/blog/no-gst-registration-required-for-small-dealers-to-supply-goods-through-ecos-notification),
  [GST Council TCS FAQs](https://www.gstcouncil.gov.in/sites/default/files/2024-02/faqs_tcs.pdf).
- TDS 194-O: [ClearTax](https://cleartax.in/s/section-194o), [Aditya Birla Capital](https://www.adityabirlacapital.com/abc-of-money/section-194o-of-income-tax-act).
