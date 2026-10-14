# Track & Review My Order

## Current data path

The checkout already saves one validated `lines_json` record per order in D1. Each line can contain:

- product, quantity, options, color and server-calculated price;
- personalization text, font, color, placement, comments and proof choice;
- original uploaded artwork links;
- the complete customizer record, including text and image layers, positions, scale, rotation, crop and print areas;
- saved preview image links, including one preview per coaster when a set uses different designs.

The customer page reads those saved records. It does not recreate artwork or render a new approximation.

## Customer access

After a paid Checkout session is verified, the Worker creates a 180-day private order link. The usable token is sent in the URL fragment, so it is not included in the HTTP request, access logs or referrer headers. The page sends it in an authorization header when it requests the order.

D1 stores a random nonce and a SHA-256 digest, not the usable token. A server secret signs the nonce. An administrator can resend, replace or revoke the link. Replacing it immediately invalidates the previous link.

The private response includes the customer's own order, saved artwork and shipping details only. Missing, modified, expired and revoked tokens all return the same not-found response.

## Design approval and production gate

Proofs exist only for lines whose saved customization requests a proof. A design made once for a complete set creates one approval. A set with different designs creates one approval per design.

Each proof begins as `pending` and accepts one terminal customer response:

- `approved`; or
- `changes_requested`, with a required comment.

A duplicate identical response is harmless. A different second response is refused. When a change is requested, the administrator must save the new preview; that returns the proof to `pending`. Production, shipment and fulfillment remain blocked until every required proof is approved.

## Order and shipment states

The customer page displays payment, production and shipment information separately. Production states are:

`not_started → awaiting_approval → ready → in_production → shipped → delivered`

`changes_requested` is a hold. Tracking carrier, number and HTTPS link are stored on the order and displayed only through the private page.

## Confirmation email

The paid-order webhook sends a Lacci Studio confirmation separate from the payment processor's receipt. It includes:

- order number, items and total;
- the exact saved preview images available on the order;
- the private Track & Review link;
- approval wording only when the saved order requires approval.

The send uses a stable idempotency key. The successful timestamp is stored in D1. If sending fails, the webhook is not marked complete, allowing the payment processor to retry without changing payment totals or creating another order.

Required configuration before deployment:

- `ORDER_LINK_SECRET` as a secret with at least 32 random bytes;
- `EMAIL_API_KEY` as a secret;
- `EMAIL_API_URL` as the HTTPS transactional email endpoint;
- `ORDER_EMAIL_FROM` as a verified sender on `laccistudio.com`.

## Deployment order

1. Configure the email sender and the two secrets in the sandbox environment.
2. Apply migration `0004_order_review.sql` to the sandbox D1 database.
3. Deploy a non-production branch preview.
4. Complete a sandbox Checkout order with two different coaster designs and proof enabled.
5. Verify one confirmation email, both exact previews, two independent proof decisions, production blocking, link replacement, expiration and revocation.
6. Verify mobile and desktop layouts.
7. Apply the migration and configuration to production only after the owner approves the verified preview.

The production branch and live D1 database must not be changed as part of local verification.

## Local verification results

Repeated measurements use the median of three runs.

| Check | Before | After | Result |
|---|---:|---:|---|
| Commerce and security suite | 36 of 39 passed | 37 of 40 passed | The new end-to-end guest-order security case passed; the same three catalog expectation failures remain open |
| New two-design order case | Not present | 1 of 1 passed | Two exact previews, two proof records, email idempotency, production gate, revision, tracking, expiry, replacement and revocation verified |
| Inline script parsing | Not measured | 4 of 4 parsed | Passed |
| Edited page structure | Not measured | 3 of 3 balanced | Passed |
| Responsive customer page | Not present | Desktop and 390 × 844 mobile | Passed; both proof actions were driven through the page |

The three existing suite failures are catalog/test disagreements, not regressions from this feature:

- the test still expects a 30 oz Glitter tumbler that the current catalog does not offer;
- the test expects coaster sets of 10 and 12 to be hidden, while the current catalog exposes them;
- the all-products price test still expects a 40 oz tumbler option that the current visible-option rules do not return.

These disagreements were present in all three baseline runs and all three post-change runs. They should be resolved as a separate catalog decision because changing them here could alter the existing shop and checkout.
