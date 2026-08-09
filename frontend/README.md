# Arc Trade frontend

This is an isolated React/TypeScript MVP for the already deployed documentary trade agreement. It reads the generated `../config.json` ABI and address by default, reads live agreement state through `VITE_ARC_RPC_URL`, and reads settlement lifecycle rows from the existing relayer.

## Local setup

```sh
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Required variables:

```dotenv
VITE_CONTRACT_ADDRESS=0xccd28351f664c02e99e83fe54d6c5825d485499e
VITE_CONTRACT_ABI=                 # optional JSON override; config.json is used by default
VITE_RELAYER_BASE_URL=http://localhost:3001
VITE_ARC_RPC_URL=https://your-arc-rpc.example
VITE_DEPLOYMENT_BLOCK=55972787      # optional; config.json is used by default
VITE_CLIENT_KEY=                    # Circle test client key; keep in .env.local
VITE_CLIENT_URL=https://modular-sdk.circle.com/v1/rpc/w3s/buidl
```

The frontend now initializes Circle Modular Wallets directly. On first sign-in it registers a passkey; returning users use the same sign-in name to authenticate with that passkey. Circle creates the Arc Testnet smart account and submits contract calls through its bundler with testnet fee sponsorship. Keep `VITE_CLIENT_KEY` in `.env.local`; do not commit it. The client key's web domain must include `localhost` for local development.

## How it works

Role visibility is derived from `getTerms()` after authentication. Agreement and milestone data are read from the configured deployed address. Payment securing first approves the configured token for the agreement and then calls `depositUSDS()`. All other visible actions call the current agreement interface. Settlement rows are discovered from `/transfers`, matched by event metadata, restored with historical event queries, and refreshed every five seconds until terminal.

The architecture diagram is in [docs/architecture.md](docs/architecture.md).

## Judge demo path

1. Start the existing relayer and this frontend.
2. Sign in as buyer or seller and show the agreement terms and proposal approvals.
3. Propose/approve the milestones with both participant accounts.
4. As buyer, secure the agreed amount; switch back to the seller to submit a document reference.
5. Confirm, release, or open a concern, then use the arbitrator account for resolution.
6. Show the milestone settlement status progressing to `Payment confirmed` when the relayer reports `MINTED`; refresh the page to demonstrate restoration.

Run `npm run build` for the production build and `npm run audit` for the rendered-language audit.
