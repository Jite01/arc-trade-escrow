-- Corrective commercial-registry migration. This migration does not alter
-- contracts, factories, or settlement tables.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_status')
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agreement_status_legacy') THEN
    ALTER TYPE agreement_status RENAME TO agreement_status_legacy;
    CREATE TYPE agreement_status AS ENUM ('drafting', 'negotiating', 'agreed', 'deploying', 'deployed', 'cancelled');
    ALTER TABLE trade_agreements
      ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE trade_agreements
      ALTER COLUMN status TYPE agreement_status
      USING (CASE WHEN status::text IN ('active', 'completed') THEN 'deployed' ELSE status::text END)::agreement_status;
    ALTER TABLE trade_agreements
      ALTER COLUMN status SET DEFAULT 'drafting'::agreement_status;
    DROP TYPE agreement_status_legacy;
  END IF;
END $$;

ALTER TYPE proposal_status ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE proposal_status ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE negotiation_event_type ADD VALUE IF NOT EXISTS 'commitment_expired';

ALTER TABLE trade_agreements
  ADD COLUMN IF NOT EXISTS onchain_state VARCHAR,
  ADD COLUMN IF NOT EXISTS last_indexed_block BIGINT,
  ADD COLUMN IF NOT EXISTS last_indexed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_named_place VARCHAR,
  ADD COLUMN IF NOT EXISTS delivery_named_place_type VARCHAR,
  ADD COLUMN IF NOT EXISTS negotiation_round INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS commitment_expired_at TIMESTAMPTZ;

ALTER TABLE trade_agreements
  DROP CONSTRAINT IF EXISTS trade_agreements_onchain_state_check;
ALTER TABLE trade_agreements
  ADD CONSTRAINT trade_agreements_onchain_state_check
  CHECK (onchain_state IS NULL OR onchain_state IN ('NEGOTIATION', 'COMMITTED', 'ACTIVE', 'FINALIZED'));

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS parent_proposal_id UUID REFERENCES proposals(id),
  ADD COLUMN IF NOT EXISTS proposal_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS accepted_by_buyer_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_by_seller_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS agreement_finalizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES trade_agreements(id),
  proposal_id UUID NOT NULL REFERENCES proposals(id),
  negotiation_round INTEGER NOT NULL DEFAULT 1,
  finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_by VARCHAR NOT NULL,
  finalized_payload JSONB NOT NULL,
  finalized_payload_hash VARCHAR(64) NOT NULL,
  contract_address VARCHAR,
  chain_id INTEGER,
  deployment_tx_hash VARCHAR,
  deployment_block BIGINT,
  UNIQUE (agreement_id, negotiation_round)
);

CREATE INDEX IF NOT EXISTS agreement_finalizations_contract_idx
  ON agreement_finalizations (lower(contract_address));

CREATE OR REPLACE FUNCTION enforce_proposal_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'pending') THEN
    RAISE EXCEPTION 'Invalid proposal status transition';
  ELSIF OLD.status = 'pending' AND NEW.status NOT IN ('pending', 'accepted', 'superseded', 'rejected', 'expired') THEN
    RAISE EXCEPTION 'Invalid proposal status transition';
  ELSIF OLD.status IN ('accepted', 'superseded', 'rejected', 'expired') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'Invalid proposal status transition';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposals_status_transition ON proposals;
CREATE TRIGGER proposals_status_transition
BEFORE UPDATE OF status ON proposals
FOR EACH ROW EXECUTE FUNCTION enforce_proposal_status_transition();
