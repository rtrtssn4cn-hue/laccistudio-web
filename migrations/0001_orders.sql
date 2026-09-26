-- Orders placed through Stripe Checkout. One row per checkout session.
-- A row starts as 'pending' when the customer is sent to Stripe and becomes 'paid' only after
-- Stripe confirms payment server-side (webhook, or a server call to Stripe from the status check).
CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number    TEXT UNIQUE,
  session_id      TEXT UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | payment_failed | expired | fulfilled | cancelled
  created_at      TEXT NOT NULL,
  paid_at         TEXT,
  fulfilled_at    TEXT,
  livemode        INTEGER NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'usd',
  subtotal_cents  INTEGER NOT NULL,
  shipping_cents  INTEGER,
  tax_cents       INTEGER,
  discount_cents  INTEGER,
  total_cents     INTEGER,
  customer_name   TEXT,
  customer_email  TEXT,
  customer_phone  TEXT,
  shipping_json   TEXT,      -- name + address as returned by Stripe
  lines_json      TEXT NOT NULL,  -- server-validated lines: product, options, personalization, file links, prices
  packing_json    TEXT,      -- coaster count and suggested box from content/shipping.json
  payment_intent  TEXT,
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS orders_status_created ON orders (status, created_at);

-- Every Stripe event id processed, so a re-delivered event is ignored (idempotency).
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id     TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  session_id   TEXT,
  received_at  TEXT NOT NULL
);
