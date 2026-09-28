-- Order requests: orders over 20 items are saved without payment for the owner to confirm.
-- orders.status goes requested -> confirmed (or declined) -> pending (payment page opened) -> paid.
-- The worker also creates this table on first use, so running this file is optional. Safe to run more than once.
CREATE TABLE IF NOT EXISTS order_requests (
  order_number TEXT PRIMARY KEY,   -- orders.order_number
  access_key   TEXT NOT NULL,      -- random key in the customer's private link
  needed_by    TEXT,               -- YYYY-MM-DD the customer needs it by
  message      TEXT,
  created_at   TEXT NOT NULL,
  confirmed_at TEXT,
  declined_at  TEXT,
  reply        TEXT                -- owner's note shown on the customer's page
);
