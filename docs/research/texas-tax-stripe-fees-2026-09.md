# Sales tax and Stripe payments research: Lacci Studio LLC (Houston, TX 77020)

Research date: 2026-09-26. Web sources only. This presents the rules and cites them. It is not legal or tax advice. Anything not confirmed from a primary source is marked **UNVERIFIED**.

---

## A. Texas sales tax

### 1. Sourcing for a Texas seller with one Texas place of business (origin vs destination)

- **Basic rule (Comptroller Pub. 94-105, "Local Sales and Use Tax Collection – A Guide for Sellers", rev. 04/2022):** "local sales tax is based on the seller's place of business." A place of business is "a store, office or other location operated by the seller to sell taxable items where sales personnel receive three or more orders during the calendar year."
  https://comptroller.texas.gov/taxes/publications/94-105.php
- **Scenarios in 94-105 / 34 TAC §3.334(c):**
  - Order placed in person at a Texas place of business: consummated there, "regardless of the location where the order is fulfilled."
  - Order received at a Texas place of business and fulfilled somewhere else: consummated "at the place of business where the order is received."
  - Order received at a location that is not a place of business and fulfilled from a Texas location that is not a place of business: tax is due "at the location in Texas where the order is shipped or delivered" (destination).
  - "Fulfill" means "to complete an order by transferring possession of a taxable item to a purchaser, or to ship or deliver a taxable item to a location designated by the purchaser." The receiving location is "the physical location ... where an order is initially received by or on behalf of the seller."
  - Source: 34 TAC §3.334, Cornell LII copy, which says the rule was last amended effective July 4, 2024 (49 TexReg issue 26). https://www.law.cornell.edu/regulations/texas/34-Tex-Admin-Code-SS-3-334
- **Additional local use tax (exception going the other way):** a Texas seller must also collect local use tax when it ships into a jurisdiction with a higher combined local rate, up to the 2% local cap (94-105; Pub. 94-171 "Online Orders – Texas Purchasers and Sellers", 11/2020: "you must also collect any additional local use tax due where the item is shipped or delivered"). https://comptroller.texas.gov/taxes/publications/94-171.php
- **Seller at a location with no local tax:** no separate passage found. Under the additional-local-use-tax rule above, the destination's local use tax would apply, up to 2%. This reading is an inference and is **UNVERIFIED** as a direct quote.
- **Internet orders: the rule is in flux. Treat as UNSETTLED.**
  - The Comptroller's 2020–2024 amendments said internet orders are not "received" at a place of business, and that a website does not count as one. That would have moved many online sales to destination sourcing.
  - Cities sued (Coppell, Round Rock and others).
  - The City of Coppell's Rule 3.334 timeline says that in **December 2024** Judge Karen Crump (250th District Court) "permanently enjoin[ed] the Comptroller ... from enforcing the rule." https://www.coppelltx.gov/1009/Rule-3334-Timeline
  - Secondary summaries (Sovos, VATupdate) describe the same ruling, but one of them gives the date as "December 3, 2025". The date conflict, any appeal, and which text is currently operative are **UNVERIFIED**.
  - The Comptroller's April 2024 proposal also added a presumption that "a small, independent business that conducts all of its business operations out of a single location" has a place of business there (Reed Smith summary; secondary). https://www.reedsmith.com/en/perspectives/2024/04/texas-comptroller-proposes-further-amendments-to-local-tax-rule
- **Practical note for Lacci (fact check, not advice):**
  - Houston's local rate is already at the 2% cap (see item 7).
  - Under origin sourcing, every Texas sale sourced to the Houston location is 8.25%.
  - Additional local use tax cannot push the rate above 8.25%.
  - Under destination sourcing, the customer's own local rate would apply, which can be lower than 8.25%.

### 2. Texas customer, local delivery by the seller
- 94-105 has no separate rule for delivery in the seller's own vehicle. The same consummation rules apply: where the order is received or fulfilled, plus additional local use tax at the delivery point if that rate is higher. For a Houston seller at the 2% cap, no additional local tax can be due. The absence of a separate rule was confirmed on the page. The consequence is an inference.

### 3. Texas customer, in-person pickup
- An order placed in person at the seller's place of business is sourced there, "regardless of the location where the order is fulfilled" (94-105; §3.334(c)).
- For an online order picked up in person, no dedicated passage was found (**UNVERIFIED**). Under the "fulfill" definition, the transfer of possession would happen at the seller's location.

### 4. Shipping, delivery and handling charges
- **34 TAC §3.303 (Transportation and Delivery Charges; Cornell copy shows last amendment April 13, 2005):**
  - "The sales tax applies to all transportation or delivery charges to a customer when a taxable item is sold."
  - Charges "are taxable even if stated separately from the sales price of a taxable item."
  - Narrow exception: separately stated postage is not taxable when the seller incurs it "at the request of the client to distribute taxable items to third party recipients".
  - https://www.law.cornell.edu/regulations/texas/34-Tex-Admin-Code-SS-3-303
- Pub. 94-171: "Texas sellers must collect sales tax on taxable items, including shipping and delivery charges, sold online in Texas."
- Handling: the remote-seller page lists separately stated handling within gross revenue. That handling is taxable follows from "all ... delivery charges", but no explicit handling quote was found (**UNVERIFIED**).

### 5. Permit and filing frequency
- **Permit required:**
  - 94-171: "If you are in Texas and sell taxable items, you must have a Texas sales tax permit – unless your sales qualify as occasional sales."
  - §3.286: "each seller who is engaged in business in this state ... must apply to the comptroller and obtain a sales and use tax permit."
  - The Texas threshold of $500,000 applies to *remote* sellers only (see item 8). Stripe's Texas doc agrees: a seller whose head office is in Texas is "not a remote seller" and "must register due to your physical presence."
- **Filing frequency (34 TAC §3.286, Cornell copy, amended effective Jan 1, 2020):**
  - Monthly if state tax is $1,500 or more per quarter.
  - Quarterly if under $1,500 per quarter.
  - **Yearly** if under $1,000 in state sales and use tax per year, on Comptroller authorization. Yearly filing is revoked if liability exceeds $1,000 in a calendar year.
- Due dates (comptroller.texas.gov/taxes/sales/):
  - Monthly: the 20th of the following month.
  - Quarterly: Apr 20, Jul 20, Oct 20, Jan 20.
  - Yearly: Jan 20.
  - "Taxpayers will be notified by letter after their application" of their frequency.
- Whether a zero ("no sales") return must still be filed each period: **UNVERIFIED** here, not fetched.

### 6. Personalized and custom-printed goods
- 34 TAC §3.300 (Manufacturing; Custom Manufacturing; Fabricating; Processing; amended effective Oct 12, 2004):
  - Custom manufacturing means "producing tangible personal property to the special order of the customer."
  - Manufacturers "must collect sales tax on the total sales price of the manufactured item," including "materials, labor or service costs, and all expenses connected with production."
  - When the customer supplies the item, tax is due on "such fabricating, custom manufacturing, or processing charge."
  - The printing-related exemptions in §3.300 are for *equipment and supplies* used by printers, and for free newspapers. They are not for the sale of printed goods.
  - https://www.law.cornell.edu/regulations/texas/34-Tex-Admin-Code-SS-3-300
- Printed coasters, mugs, tumblers and T-shirts are taxable tangible personal property. No exemption for the printing labour was found.
- Correction: **Rule 3.325 is "Refunds and Payments Under Protest"**, not printing. The printing rules are in §3.300.

### 7. Houston 77020 rate
- Comptroller "TEXAS SALES AND USE TAX RATES – July 2026" (city-rates.pdf, page 58), read directly from the PDF text:
  - "Houston (Harris Co) 2101017 .010000 .082500"
  - "Houston MTA 3101990 .010000"
  - That is state 6.25% + City of Houston 1% + METRO 1% = **8.25%**.
  - https://comptroller.texas.gov/taxes/sales/docs/city-rates.pdf
- Caveat: one "Houston (Harris Co)" row in the same table shows a total of .072500 (a Houston area with no MTA/SPD layer). Whether the specific 77020 street address falls in the 8.25% area should be confirmed with the Comptroller's address-level Sales Tax Rate Locator. That lookup was not run here (**UNVERIFIED for the exact address**).
- Statewide cap: 6.25% state plus "up to 2 percent" local, a "maximum combined rate of 8.25 percent" (comptroller.texas.gov/taxes/sales/).

### 8. Out-of-state economic nexus
- Source: Sales Tax Institute, "Economic Nexus State Guide", page last updated **Aug 1, 2026** (secondary but widely used). https://www.salestaxinstitute.com/resources/economic-nexus-state-guide
- **States with a transaction-count test (per that page):**
  - Connecticut: $100,000 **and** 200 transactions.
  - These use $100,000 **or** 200 transactions: Maryland, Michigan, Minnesota (200 retail sales), Nebraska, Nevada, New Jersey, Rhode Island, Vermont, West Virginia, and Puerto Rico.
  - New York: $500,000 **and** more than 100 sales.
- **Recently removed the count test:**
  - 2022–2024: Maine (1/1/2022), South Dakota (7/1/2023), Louisiana (8/1/2023), Indiana (1/1/2024), Wyoming (7/1/2024), North Carolina (7/1/2024).
  - 2025–2026: Alaska (1/1/2025), Utah (7/1/2025), Illinois (1/1/2026), Kentucky (8/1/2026).
- **Thresholds above $100,000:** Alabama $250,000; Mississippi more than $250,000; California $500,000; Texas $500,000; New York $500,000 and 100 sales.
- **Below $100,000:** the page lists **none**. Pennsylvania has a $10,000 notice-and-reporting option, but mandatory collection starts at $100,000.
- No state sales tax: Delaware, Montana, New Hampshire, Oregon. Alaska has local taxes only.
- **Factual conclusion:** at a few online sales per year, far under $100,000 in total, Lacci **appears** to be below every state's economic-nexus threshold. The most sensitive tests are the 200-transaction ones, and one state would need 200 sales into it within the measurement period. This is not a legal determination.

### 9. Marketplace (Etsy) sales and thresholds
- Per the same Sales Tax Institute page, marketplace sales **count** toward the remote seller's own threshold in:
  - AK, CA, CT, DC, GA, HI, ID, IA, KS, MD, MI, MN, NE, NV, NJ, NY, NC, OH, PR, RI, SC, SD, **TX**, VT, WA, WI.
- Marketplace sales are **excluded** in:
  - AL, AZ, AR, CO, FL, IL, IN, LA (individual sellers), ME, MA, MS, MO, NM, ND, OK, PA, TN, UT, VA, WY.
- Texas primary source (remote-sellers page): the threshold counts gross revenue from sales into Texas. Sellers whose marketplace provider collects "don't need a permit" for those sales, but "all sellers must keep required records of all marketplace sales for at least four years." https://comptroller.texas.gov/taxes/sales/remote-sellers.php
- Stripe's Texas doc also says the threshold "includes gross sales, including marketplace sales."

---

## B. Stripe Tax

### 10. Pricing (stripe.com/tax/pricing, fetched 2026-09-26)
- **Tax Basic (pay as you go), no subscription required:**
  - No-code integration, which includes Checkout: **"0.5% per transaction, where you're registered to collect taxes"**.
  - API integration: **"50¢ per transaction, where you're registered to collect taxes"**. Each transaction includes 10 calculation calls, and each extra call is 5¢.
- **Tax Complete (optional subscription, all tiers require a 1-year contract):**

  | Tier | Price per month | Registrations per year | Transactions per month | Filings per year |
  |---|---|---|---|---|
  | 1 | $90 | 2 | 200 | 4 |
  | 2 | $430 | 4 | 1,000 | 12 |
  | 3 | $1,000 | 6 | 2,500 | 20 |
  | 4 | $1,500 | 10 | 5,000 | 32 |

  - "Additional fees may apply ... if you exceed your plan's limits."
- No per-transaction minimum and no monthly minimum were shown for Tax Basic. The page did not state that a plan is required to use Checkout's automatic tax, so none appears to be required.
- The zero-tax doc says Stripe Tax fees apply in excluded territories if you are registered in the parent country. That is not relevant to a US-only seller.

### 11. Stripe Tax for a Texas-only registration
- **Intrastate Texas:** "If your customer is in Texas and your head office is also in Texas, Stripe applies tax based on your head office, depending on the type of product or service you sell." https://docs.stripe.com/tax/supported-countries/united-states/texas
- For customers outside Texas: "Stripe always calculates tax based on your customer's location."
- Ship-from doc: Stripe uses the head office as the origin by default. A "same-state rule ... currently applies to Texas", but per-transaction ship-from addresses are "available only through the Stripe Tax API", not in Checkout. https://docs.stripe.com/tax/ship-from-address
- Whether Stripe adds Texas *additional local use tax* when shipping to a higher-rate area is not stated (**UNVERIFIED**). For a Houston origin already at 8.25%, it would make no difference.
- **Unregistered states:** Stripe calculates zero tax with `taxability_reason: not_collecting` ("You must register before collecting tax in a jurisdiction"). The pricing page charges the 0.5% only "where you're registered." https://docs.stripe.com/tax/zero-tax
- **Shipping:** Stripe Tax can tax shipping when a tax code is set on the shipping rate. The shipping code is `txcd_92010001`, and shipping rates carry `tax_behavior` and `tax_code` (search summary of docs.stripe.com/tax/products-prices-tax-codes-tax-behavior). That Stripe applies each state's shipping-taxability rule automatically is **UNVERIFIED**; the docs page fetched did not state it explicitly.

### 12. Tax by shipping address in Checkout without Stripe Tax
- **`dynamic_tax_rates`:** the current Create Checkout Session API reference lists only `line_items.tax_rates` ("The tax rates which apply to this line item"). **No `dynamic_tax_rates` child parameter appears.** That is consistent with the account rejecting it. The Tax Rates doc still says the tax rate `country`/`state` properties can be used "to apply dynamic tax rates based on your customer's billing or shipping address in Checkout Sessions". That doc wording is stale relative to the API reference. https://docs.stripe.com/billing/taxes/tax-rates
- **Static `tax_rates`:**
  - Can be set per line item at session creation.
  - Stripe says of Tax Rate objects: "we won't automatically set them on your behalf."
  - `shipping_rate_data` exposes `tax_behavior` and `tax_code` but not `tax_rates`. So under manual rates, taxing shipping would mean adding shipping as a taxed line item. This is an inference from the API fields (**UNVERIFIED** as a documented pattern).
- **Update the session after the address is entered:** `POST /v1/checkout/sessions/{id}` can update `line_items` (each accepts `tax_rates`), `shipping_options` (up to 5), `metadata`, and `collected_information` ("Can only be set when updating `embedded` or `custom` sessions"). https://docs.stripe.com/api/checkout/sessions/update
- **Which UI modes support the address callback** (ui_mode values now: `hosted_page`, `embedded_page`, `form`, `elements`):
  - Hosted page and full embedded page do **not** support dynamic shipping updates: "The full embedded page doesn't support dynamically customizing shipping options."
  - The **embedded form** (`ui_mode=form`) does. Listen for the form `change` event, call `actions.runServerUpdate(...)` (20-second timeout), and have the server update the session. The embedded form "doesn't support the `permissions` parameter." Express wallets (Apple Pay and Google Pay) "bypass the server-side update flow."
  - The Elements integration also supports it, using `permissions.update_shipping_details=server_only` (added in API version 2025-03-31).
  - https://docs.stripe.com/payments/checkout/custom-shipping-options.md?payment-ui=checkout-form
  - Updating `line_items[].tax_rates` in that server callback is allowed by the API reference, but the guide shows only `shipping_options`. That this works as a tax pattern is **UNVERIFIED**.
- **Collect the state before creating the session:** ask for the ship-to state (or Texas yes/no) on the site, then create a hosted session with the matching `tax_rates` and restrict `shipping_address_collection` accordingly. This is standard API usage. No Stripe guide was found describing it.

---

## C. Stripe fees (US standard pricing, stripe.com/pricing and /pricing/local-payment-methods, fetched 2026-09-26)

| Method | Fee |
|---|---|
| Domestic cards | 2.9% + 30¢ per successful transaction |
| International cards | +1.5% |
| Currency conversion | +1% |
| Manually entered cards | +0.5% |
| Apple Pay / Google Pay | 2.9% + 30¢ (card rates) |
| Link (card) | 2.9% + 30¢. Link stablecoins 0.8%, promotional through Jan 1, 2027 |
| Link Instant Bank Payments ("Bank") | **2.6% + 30¢** (search summary of stripe.com/blog/reduce-payments-costs-with-instant-bank-payments-via-link; not on the main pricing page, so **UNVERIFIED** as current) |
| Cash App Pay | 2.9% + 30¢ |
| Affirm | 6% + 30¢ standard (7.99% + 30¢ "Enhanced") |
| Klarna | 5.99% + 30¢ |
| Afterpay | 6% + 30¢ |
| Zip | 4.5% + 30¢ |
| Amazon Pay | 2.9% + 30¢ |
| ACH Direct Debit | 0.8%, $5 cap (standard settlement). 1.2% for two-day settlement |
| Disputes | $15 per dispute received. A $15 counter fee, refunded if won |
| Refunds | "There are no fees for issuing refunds", but the original processing fee is not returned |
| Checkout itself | No extra fee. Options: custom domain $10/month; post-payment invoices 0.4% (capped at $2 per invoice) |
| Setup / monthly | "Stripe does not charge setup fees, monthly fees" |

- **"$5 back" Link promotion:** Stripe docs confirm Stripe-funded cash-back offers for Instant Bank Payments. They are "no cost to your business" and can be shown or hidden in Link settings. The customer is credited within about 7 business days. Link's terms require the purchase to be at least twice the reward amount. **The $5 figure itself is UNVERIFIED**: no Stripe or Link page fetched named an amount.
- **Instant Bank Payments eligibility:** turned on automatically with Link, subject to eligibility. It requires "a history of Stripe usage", is shown by default only under 7,500 USD, and is hidden if ACH Direct Debit is enabled for the transaction. https://docs.stripe.com/payments/link/instant-bank-payments
- **Defaults and restricting methods:**
  - With dynamic payment methods, which methods Checkout shows is controlled in Dashboard → Settings → Payment methods. "Only payment methods that you enabled can be shown." https://docs.stripe.com/payments/payment-methods/dynamic-payment-methods
  - Per-session ways to restrict:
    - `payment_method_types`: a static list that overrides the Dashboard settings.
    - `allowed_payment_method_types`: a filter on the dynamically eligible set.
    - `excluded_payment_method_types`: removes specific methods.
    - `payment_method_configuration`: points at a saved set of methods.
  - Apple Pay, Google Pay and Link must be controlled through wallet settings. Excluding them via `excluded_payment_method_types` "generates an error" (PaymentIntent context).
  - Which specific methods are on by default for a new US account was not listed on any fetched page (**UNVERIFIED**).

---

## Items to confirm directly
1. Status of the Rule 3.334 injunction (December 2024 vs "December 3, 2025"), any appeal, and how Comptroller guidance now treats a single-location online seller.
2. The rate for the exact 77020 address in the Comptroller Rate Locator.
3. Whether zero returns must be filed. The Comptroller's filing-frequency letter controls.
4. The current Instant Bank Payments rate and promotion amount, from the account's Dashboard.
