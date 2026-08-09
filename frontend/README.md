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
```

Before opening the page, the host application must initialize the Circle Embedded Wallet SDK and expose this adapter bridge as `window.circleEmbeddedWallet`. It must supply an authenticated account, an EIP-1193 provider, sign-in/sign-out, and account-change notifications. The frontend uses that provider to create the ethers-compatible signer; it does not assume a browser extension. If the bridge is absent, the page now reports that sign-in is not configured rather than showing a generic action failure.

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
