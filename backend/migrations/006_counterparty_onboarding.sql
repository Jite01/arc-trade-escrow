-- Counterparty onboarding for commercial agreements. This migration changes
-- only registry state; DocumentaryTradeEscrow and the Router are unchanged.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE trade_agreements
  ALTER COLUMN buyer_address DROP NOT NULL,
  ALTER COLUMN seller_address DROP NOT NULL;

ALTER TABLE trade_agreements
  DROP CONSTRAINT IF EXISTS trade_agreements_party_state_check;
ALTER TABLE trade_agreements
  ADD CONSTRAINT trade_agreements_party_state_check CHECK (
    (status = 'drafting' AND (buyer_address IS NOT NULL OR seller_address IS NOT NULL))
    OR (status <> 'drafting' AND buyer_address IS NOT NULL AND seller_address IS NOT NULL)
  );

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42) NOT NULL UNIQUE,
  company_name VARCHAR(255) NOT NULL CHECK (length(trim(company_name)) > 0),
  country VARCHAR(128) NOT NULL CHECK (length(trim(country)) > 0),
  trade_category VARCHAR(128),
  verified_trade_count INTEGER NOT NULL DEFAULT 0 CHECK (verified_trade_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_company_name_idx ON profiles (lower(company_name));

CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR(64) NOT NULL UNIQUE,
  agreement_id UUID NOT NULL REFERENCES trade_agreements(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL DEFAULT 'seller' CHECK (role IN ('buyer', 'seller')),
  created_by VARCHAR(42) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by VARCHAR(42),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP INDEX IF EXISTS invitations_one_unaccepted_per_agreement_idx;
CREATE UNIQUE INDEX invitations_one_unaccepted_per_agreement_idx
  ON invitations (agreement_id) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS invitations_expiry_idx ON invitations (expires_at);

CREATE OR REPLACE FUNCTION touch_profile_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_touch_updated_at ON profiles;
CREATE TRIGGER profiles_touch_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION touch_profile_updated_at();
