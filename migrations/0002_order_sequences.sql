-- Separate order-number sequences for live and sandbox orders.
-- Live orders: LS-1001, LS-1002, ...   Sandbox (Stripe test mode) orders: TEST-LS-1001, TEST-LS-1002, ...
-- Snipcart orders (SNIP-####) are not stored in this database and are not affected.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS order_sequences (
  mode  TEXT PRIMARY KEY,   -- 'live' | 'test'
  last  INTEGER NOT NULL    -- last number issued
);

-- Existing sandbox orders are kept and relabelled, so LS- numbers only ever belong to live orders.
UPDATE orders
   SET notes = COALESCE(notes || ' | ', '') || 'Renumbered from ' || order_number || ' (sandbox order; Stripe still shows the old number).',
       order_number = 'TEST-' || order_number
 WHERE livemode = 0 AND order_number LIKE 'LS-%';

INSERT OR IGNORE INTO order_sequences (mode, last)
  SELECT 'test', COALESCE(MAX(CAST(SUBSTR(order_number, 9) AS INTEGER)), 1000) FROM orders WHERE order_number LIKE 'TEST-LS-%';
INSERT OR IGNORE INTO order_sequences (mode, last)
  SELECT 'live', COALESCE(MAX(CAST(SUBSTR(order_number, 4) AS INTEGER)), 1000) FROM orders WHERE livemode = 1 AND order_number LIKE 'LS-%';
