# Phase 3 frontend handoff

This handoff brings the Phase 1/2 implementation agent up to speed on the current frontend state.

## What was added

The isolated React/Vite/TypeScript app is in `frontend/`. It consumes the existing generated `config.json`, deployed agreement, and relayer API. It does not modify the Solidity contract, deployed contract, relayer source, SQLite data, Gateway integration, or RPC/WSS configuration.

The frontend includes:

- Live agreement reads from `getState`, `getTerms`, `getMilestones`, `getMilestoneStatus`, `getApprovals`, `getBalances`, and `getCurrentMilestoneIndex`.
- Role visibility for BUYER, SELLER, ARBITRATOR, and READ_ONLY.
- Negotiation proposal, approval, cancellation, expiry, and commitment-abandonment controls.
- Circle Modular Wallet passkey registration/login for Arc Testnet.
- Circle smart-account transaction submission through the modular bundler and an ethers-compatible signer adapter.
- Buyer token approval followed by `depositUSDS()`.
- Milestone trigger, confirmation, dispute, release, arbitration, reclaim, and forced-resolution actions.
- Contract refresh polling, event listeners, historical restoration, and relayer settlement polling.
- Safe settlement labels: Payment processing, Payment confirmed, and Payment failed — contact support.
- Finalized agreement read-only mode.
- Rendered-language audit and architecture documentation.

## Commits

```text
87ca06d Add React escrow frontend
ae96fcc Clarify embedded sign-in configuration error
5cac112 Integrate Circle modular wallet sign-in
```

The latest frontend integration is in `5cac112`.

## Local setup

```sh
cd frontend
npm install
cp .env.example .env.local
```

Edit `frontend/.env.local`:

```dotenv
VITE_CLIENT_KEY=<Circle test client key>
VITE_CLIENT_URL=https://modular-sdk.circle.com/v1/rpc/w3s/buidl
VITE_ARC_RPC_URL=<existing Arc RPC URL>
VITE_RELAYER_BASE_URL=http://localhost:3001
```

The Circle client key must allow the `localhost` web domain. It must remain in `.env.local` and must not be committed. Start with:

```sh
npm run dev
```

The first sign-in registers a passkey for a username. Reusing that username attempts passkey login. Circle’s Arc Testnet modular-wallet flow is implemented in `frontend/src/wallet.ts`.

## Verification

The following pass:

```sh
cd frontend
npm run build
npm run audit
```

The production build succeeds and the forbidden rendered-language audit passes.

## Critical compatibility check

The deployed agreement authorizes immutable buyer, seller, and arbitrator addresses. A newly created Circle smart-account address must match one of those configured agreement roles to submit permitted actions. If it does not, the frontend will correctly identify the account as READ_ONLY and contract calls will fail authorization. The client key cannot alter agreement roles.

Before the demo, authenticate each intended participant and confirm the displayed role. If the Circle accounts do not match the existing configured roles, Phase 1/2 must provide the compatible account setup or a separately approved agreement configuration; do not change the deployed contract from the frontend.

## Boundaries preserved

- No frontend deployment or factory flow.
- No Gateway calls from the frontend.
- No BurnIntent, salt, attestation, operator-signature, or private settlement data handling.
- No transfer-hash invention; settlement rows come from relayer event metadata.
- Existing unrelated modifications in `package.json`, `package-lock.json`, and the deployment broadcast file were not included in the frontend commits and should be reviewed by the Phase 1/2 owner separately.
