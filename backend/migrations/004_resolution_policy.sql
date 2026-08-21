-- Resolution Router commercial integration. The router is the escrow's fixed
-- arbitration authority; a nominated resolver is case-policy metadata and is
-- not an on-chain authorization by itself.
ALTER TABLE trade_agreements
  ADD COLUMN IF NOT EXISTS resolution_policy VARCHAR(32) NOT NULL DEFAULT 'ARCTRADE_DEFAULT',
  ADD COLUMN IF NOT EXISTS assigned_resolver_address VARCHAR(42);

ALTER TABLE trade_agreements
  DROP CONSTRAINT IF EXISTS trade_agreements_resolution_policy_check;
ALTER TABLE trade_agreements
  ADD CONSTRAINT trade_agreements_resolution_policy_check
  CHECK (resolution_policy IN ('ARCTRADE_DEFAULT', 'MUTUAL_RESOLVER'));

CREATE INDEX IF NOT EXISTS trade_agreements_resolution_policy_idx
  ON trade_agreements (resolution_policy);
