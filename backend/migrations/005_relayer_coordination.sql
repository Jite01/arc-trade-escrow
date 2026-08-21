-- Distributed relayer coordination. A claim is intentionally retained until
-- the settlement is finalized; uncertain Gateway work must be reconciled by an
-- operator before another host is allowed to process the logical settlement.
CREATE TABLE IF NOT EXISTS relayer_settlement_claims (
  logical_settlement_key VARCHAR PRIMARY KEY,
  owner_id VARCHAR NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS relayer_settlement_claims_active_idx
  ON relayer_settlement_claims (completed_at, claimed_at);
