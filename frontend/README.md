# Arc Trade frontend — functional MVP

This is an isolated React/TypeScript MVP for the already deployed documentary trade agreement. It reads the generated `../config.json` ABI and address by default, reads live agreement state through `VITE_ARC_RPC_URL`, and reads settlement lifecycle rows from the existing relayer.

## Local setup

Start the existing relayer from the repository root first:

```sh
./regenerate-config.sh
npm run build
npm start
```

Then start the frontend in a second terminal:

```sh
cd frontend
npm install
cp .env.example .env.local
npm run build
npm run audit
npm run dev
```

Required variables:

```dotenv
VITE_CONTRACT_ADDRESS=0xfE842F9418A1e917DB11625B5120726C4A1c4E54
VITE_CONTRACT_ABI=                 # optional; generated config.json is used when empty
VITE_RELAYER_BASE_URL=http://localhost:3001
VITE_ARC_RPC_URL=https://rpc.drpc.testnet.arc.io
VITE_DEPLOYMENT_BLOCK=56099880
VITE_CLIENT_KEY=                    # Modular Wallet Web Client Key; keep local
VITE_CLIENT_URL=https://modular-sdk.circle.com/v1/rpc/w3s/buidl
```

The frontend uses Circle Modular Wallets, not developer-controlled or
user-controlled wallets. On first sign-in it registers a passkey; returning
users use the same sign-in name to authenticate with that passkey. Circle creates
the Arc Testnet smart account and submits contract calls through its bundler with
testnet fee sponsorship.

The Client Key must be created for Modular Wallets, have an entity configuration,
and allow the `localhost` web domain. Keep it in `.env.local`; never commit it.
`VITE_ARC_RPC_URL` is required. `VITE_CONTRACT_ABI` may be empty because the
frontend imports the generated ABI from `../config.json`.

The frontend runs at `http://localhost:5173`. The relayer runs separately at
`http://localhost:3001`; both must be running for the complete demo.

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

## Circle Product Feedback

### Why these products were chosen

Modular Wallets were chosen because importers and exporters should authenticate
with passkeys and approve agreement actions without managing private keys or
native-token fees. Gateway was chosen because the relayer can submit the
contract-authorized settlement to Circle while the contract remains the source
of authorization. USDC provides the stable settlement asset on Arc Testnet.

### What worked well

- Passkey-based sign-in provides a familiar user entry point.
- Gas-sponsored smart-account operations remove native-token friction from the
  demo flow.
- Gateway's attestation and minting flow provides a clear separation between
  contract authorization and settlement execution.
- Arc Testnet gives the MVP a fast, stable settlement environment.

### What could be improved

- Client-key/entity configuration errors are difficult to diagnose from the SDK
  error surface.
- The distinction between API keys, Client Keys, and Modular Wallet entity
  configuration should be more prominent during setup.
- Local development would benefit from clearer first-run diagnostics for allowed
  domains and passkey configuration.

### Recommendations

- Provide a configuration check that validates Client Key type, entity setup,
  allowed domain, and selected chain before the first passkey request.
- Return actionable error codes for missing entity configuration and domain
  mismatches.
- Provide a documented Arc Testnet starter template with the correct Vite
  environment variables and bundler endpoint.
