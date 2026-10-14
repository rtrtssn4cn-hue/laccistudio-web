-- Private guest access, design-proof decisions, production state and shipment tracking.
-- Access tokens are never stored in plaintext. The nonce is harmless without ORDER_LINK_SECRET;
-- token_hash supports constant-shape lookup and revocation without exposing the emailed token.
CREATE TABLE IF NOT EXISTS order_access (
  order_number   TEXT PRIMARY KEY,
  token_nonce    TEXT NOT NULL UNIQUE,
  token_hash     TEXT NOT NULL UNIQUE,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  revoked_at     TEXT,
  last_used_at   TEXT,
  email_sent_at  TEXT,
  email_error_at TEXT
);

CREATE INDEX IF NOT EXISTS order_access_token ON order_access (token_hash);

CREATE TABLE IF NOT EXISTS proof_decisions (
  order_number TEXT NOT NULL,
  proof_key    TEXT NOT NULL,
  line_index   INTEGER NOT NULL,
  item_index   INTEGER,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | approved | changes_requested
  comment      TEXT,
  decided_at   TEXT,
  PRIMARY KEY (order_number, proof_key)
);

CREATE INDEX IF NOT EXISTS proof_decisions_order ON proof_decisions (order_number, status);

ALTER TABLE orders ADD COLUMN production_status TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE orders ADD COLUMN tracking_carrier TEXT;
ALTER TABLE orders ADD COLUMN tracking_number TEXT;
ALTER TABLE orders ADD COLUMN tracking_url TEXT;
ALTER TABLE orders ADD COLUMN shipped_at TEXT;
ALTER TABLE orders ADD COLUMN delivered_at TEXT;
