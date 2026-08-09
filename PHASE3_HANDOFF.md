# Phase 3 frontend handoff — current checkpoint

This handoff is the current checkpoint for the Phase 3/frontend owner. The genesis
prompt is historical reference only. Continue from this document and do not
reintroduce the old deployment flow or old wallet architecture.

## Current deployed checkpoint

- Chain: Arc Testnet, chain ID `5042002`
- Contract: `0xfE842F9418A1e917DB11625B5120726C4A1c4E54`
- Deployment block: `56099880`
- Relayer RPC: `https://rpc.drpc.testnet.arc.io`
- Relayer API: `http://localhost:3001`
- Frontend dev server: `http://localhost:5173`

The root `config.json` has been regenerated from the latest deployment. The
relayer must be built and started from the repository root before using the UI.

## What was added

The isolated React/Vite/TypeScript app is in `frontend/`. It consumes the existing generated `config.json`, deployed agreement, and relayer API. It does not modify the Solidity contract, deployed contract, relayer source, SQLite data, Gateway integration, or RPC/WSS configuration.

The frontend includes:

- Live agreement reads from `getState`, `getTerms`, `getMilestones`, `getMilestoneStatus`, `getApprovals`, `getBalances`, and `getCurrentMilestoneIndex`.
- Role visibility for BUYER, SELLER, ARBITRATOR, and READ_ONLY.
- Negotiation proposal, approval, cancellation, expiry, and commitment-abandonment controls.
- Circle Modular Wallet passkey registration/login for Arc Testnet.
- Circle smart-account transaction submission through the modular bundler and an ethers-compatible signer adapter.
- Direct sign-in diagnostics for missing Circle configuration, domain/entity/passkey setup, unsupported browsers, cancelled passkey prompts, and retryable failures. The frontend does not require or reference a global sign-in bridge.
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

From the repository root, start the relayer first:

```sh
./regenerate-config.sh
npm run build
npm start
```

In a second terminal, configure `frontend/.env.local`:

```dotenv
VITE_CONTRACT_ADDRESS=0xfE842F9418A1e917DB11625B5120726C4A1c4E54
VITE_CONTRACT_ABI=
VITE_DEPLOYMENT_BLOCK=56099880
VITE_ARC_RPC_URL=https://rpc.drpc.testnet.arc.io
VITE_RELAYER_BASE_URL=http://localhost:3001
VITE_CLIENT_KEY=<Circle Modular Wallet Web Client Key>
VITE_CLIENT_URL=https://modular-sdk.circle.com/v1/rpc/w3s/buidl
```

Then start the frontend:

```sh
cd frontend
npm install
npm run build
npm run audit
npm run dev
```

`5173` serves the React UI. `3001` serves the relayer API. Do not point
`VITE_RELAYER_BASE_URL` at `5173`.

`VITE_CONTRACT_ABI` may remain empty because the frontend falls back to the
generated root `config.json`. `VITE_ARC_RPC_URL` must not be empty.

The Circle key must be a Modular Wallet Web Client Key with a configured entity,
`localhost` as the allowed web domain, and a matching passkey domain. It must
remain in `.env.local` and must not be committed. A syntactically valid key from
an unrelated Circle project is insufficient.

If sign-in cannot start, the UI provides a safe, actionable message instead of
exposing raw SDK errors. The browser console retains the underlying diagnostic for
the implementation owner. The expected messages are:

- Setup needs attention: check the Circle client key, allowed domain, and passkey domain.
- Browser support is unavailable: use a current browser with device authentication enabled.
- Sign-in was cancelled.
- Sign-in could not be completed: retry.

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

## Circle product used

The frontend uses **Circle Modular Wallets** through
`@circle-fin/modular-wallets-core`:

- passkey registration and login;
- Circle smart-account creation;
- Arc Testnet bundler transport;
- gas-sponsored user operations;
- an ethers-compatible signer adapter for contract calls.

The former `window.circleEmbeddedWallet` bridge is retired. Do not reintroduce
it; `frontend/src/wallet.ts` initializes the Circle passkey, account, and
bundler flow directly.

It does not use `@circle-fin/developer-controlled-wallets` or
`@circle-fin/user-controlled-wallets`. The root user-controlled-wallets package
is not part of the frontend execution path and should not be listed as an
integrated product in the submission.

## Submission checkpoint and finish plan

The functional MVP is complete at the application-flow level. Before submission,
the owner must complete these final gates:

1. Configure a valid Modular Wallet Web Client Key and verify sign-in from
   `http://localhost:5173`.
2. Authenticate the intended buyer, seller, and arbitrator accounts and confirm
   their roles match the immutable addresses in the deployed agreement.
3. Run the live demo through proposal, approval, securing funds, milestone
   submission, confirmation/release, settlement status, and arbitration.
4. Capture the final screen showing relayer settlement status `MINTED`.
5. Run `npm run build` and `npm run audit` in `frontend/` and `npm run build` and
   `npm test` from the repository root.
6. Review [frontend/docs/architecture.md](frontend/docs/architecture.md), record
   the demo URL, repository URL, and Circle account email for the submission.
7. Add the prepared Circle Product Feedback section from the frontend README to
   the submission materials.

Do not redeploy, modify the contract, alter Gateway custody, or change the
relayer settlement architecture as part of Phase 3 completion.

## Critical compatibility check

The deployed agreement authorizes immutable buyer, seller, and arbitrator addresses. A newly created Circle smart-account address must match one of those configured agreement roles to submit permitted actions. If it does not, the frontend will correctly identify the account as READ_ONLY and contract calls will fail authorization. The client key cannot alter agreement roles.

Before the demo, authenticate each intended participant and confirm the displayed role. If the Circle accounts do not match the existing configured roles, Phase 1/2 must provide the compatible account setup or a separately approved agreement configuration; do not change the deployed contract from the frontend.

## Boundaries preserved

- No frontend deployment or factory flow.
- No Gateway calls from the frontend.
- No BurnIntent, salt, attestation, operator-signature, or private settlement data handling.
- No transfer-hash invention; settlement rows come from relayer event metadata.
- Existing unrelated modifications in `package.json`, `package-lock.json`, and the deployment broadcast file were not included in the frontend commits and should be reviewed by the Phase 1/2 owner separately.
