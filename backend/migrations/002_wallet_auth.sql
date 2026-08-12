-- One-time challenges for production wallet authentication. This is security
-- infrastructure for the registry, not commercial agreement state.
CREATE TABLE IF NOT EXISTS auth_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42) NOT NULL,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_challenges_wallet_idx ON auth_challenges (lower(wallet_address), created_at DESC);
CREATE INDEX IF NOT EXISTS auth_challenges_expiry_idx ON auth_challenges (expires_at);
