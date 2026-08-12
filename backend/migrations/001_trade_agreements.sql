-- Commercial agreement registry. This migration intentionally contains no
-- contract or settlement tables; contract_address is only the post-deployment
-- join key back to the commercial record.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE agreement_status AS ENUM ('drafting', 'negotiating', 'agreed', 'deployed', 'active', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE transport_mode AS ENUM ('sea', 'air', 'road', 'rail', 'inland_waterway', 'multimodal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE party_arrangement AS ENUM ('seller', 'buyer', 'tba');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE proposal_status AS ENUM ('pending', 'superseded', 'accepted', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE negotiation_event_type AS ENUM ('proposal_sent', 'counter_proposed', 'accepted', 'rejected', 'expired', 'deployed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS trade_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code VARCHAR(32) NOT NULL UNIQUE,
  contract_address VARCHAR(42) UNIQUE,
  deployment_block BIGINT,
  buyer_address VARCHAR(42) NOT NULL,
  seller_address VARCHAR(42) NOT NULL,
  arbitration_address VARCHAR(42) NOT NULL,
  operator_address VARCHAR(42) NOT NULL,
  total_usdc NUMERIC(78, 6) NOT NULL CHECK (total_usdc > 0),
  negotiation_expiry TIMESTAMPTZ NOT NULL,
  commitment_window_sec INTEGER NOT NULL CHECK (commitment_window_sec > 0),
  arbitration_timeout_sec INTEGER NOT NULL CHECK (arbitration_timeout_sec > 0),
  status agreement_status NOT NULL DEFAULT 'drafting',
  goods_description TEXT NOT NULL CHECK (length(trim(goods_description)) > 0),
  goods_category VARCHAR(64),
  quantity NUMERIC(78, 6),
  quantity_unit VARCHAR(32),
  quality_standard TEXT,
  transport_mode transport_mode NOT NULL,
  origin_country VARCHAR(128) NOT NULL,
  origin_port_city VARCHAR(128) NOT NULL,
  destination_country VARCHAR(128) NOT NULL,
  destination_port_city VARCHAR(128) NOT NULL,
  incoterm VARCHAR(3),
  freight_arranger party_arrangement NOT NULL,
  insurance_arranger party_arrangement NOT NULL,
  delivery_deadline TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by VARCHAR(42) NOT NULL
);

CREATE TABLE IF NOT EXISTS proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES trade_agreements(id) ON DELETE CASCADE,
  proposed_by VARCHAR(42) NOT NULL,
  array_version INTEGER NOT NULL CHECK (array_version > 0),
  status proposal_status NOT NULL DEFAULT 'pending',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposal_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  index INTEGER NOT NULL CHECK (index >= 0),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  basis_points INTEGER NOT NULL CHECK (basis_points > 0 AND basis_points <= 10000),
  seller_deadline_sec INTEGER NOT NULL CHECK (seller_deadline_sec > 0),
  buyer_response_window_sec INTEGER NOT NULL CHECK (buyer_response_window_sec > 0),
  dispute_window_sec INTEGER NOT NULL CHECK (dispute_window_sec > 0),
  proof_description TEXT NOT NULL CHECK (length(trim(proof_description)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, index)
);

CREATE TABLE IF NOT EXISTS negotiation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES trade_agreements(id) ON DELETE CASCADE,
  event_type negotiation_event_type NOT NULL,
  actor_address VARCHAR(42) NOT NULL,
  proposal_id UUID REFERENCES proposals(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trade_agreements_buyer_idx ON trade_agreements (lower(buyer_address));
CREATE INDEX IF NOT EXISTS trade_agreements_seller_idx ON trade_agreements (lower(seller_address));
CREATE INDEX IF NOT EXISTS proposals_agreement_created_idx ON proposals (agreement_id, created_at);
CREATE INDEX IF NOT EXISTS negotiation_events_agreement_created_idx ON negotiation_events (agreement_id, created_at);

CREATE OR REPLACE FUNCTION touch_trade_agreement_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trade_agreements_touch_updated_at ON trade_agreements;
CREATE TRIGGER trade_agreements_touch_updated_at
BEFORE UPDATE ON trade_agreements
FOR EACH ROW EXECUTE FUNCTION touch_trade_agreement_updated_at();
