# Phase 3 frontend handoff — current checkpoint

This handoff is the current checkpoint for the Phase 3/frontend and relayer owner. The genesis
prompt is historical reference only. Continue from this document and do not
reintroduce the old deployment flow or old wallet architecture.

## Current deployed checkpoint

- Chain: Arc Testnet, chain ID `5042002`
- Reference contract: `0xfE842F9418A1e917DB11625B5120726C4A1c4E54` (preserved)
- Active demo contract: `0xdfe3495a871e17317b50c5b1b688554ee7194037`
- Active demo deployment block: `56139585`
- Relayer RPC: configured by `ARC_RPC_URL`; the current local `.env` uses `https://rpc.testnet.arc.network`
- Relayer API: `http://localhost:3001`
- Frontend dev server: `http://localhost:5173`

The root `config.json` has been regenerated from the latest deployment. The
relayer must be built and started from the repository root before using the UI.

## What was added

The isolated React/Vite/TypeScript app is in `frontend/`. It consumes the existing generated `config.json`, deployed agreement, and relayer API. It does not modify the Solidity contract, deployed contract, SQLite data, or Gateway integration. The relayer now includes an explicit HTTP `eth_getLogs` event-polling fallback so live event delivery does not depend on an available WebSocket subscription.

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
9a83e32 Document relayer RPC subscription incident
78703c6 Refresh frontend checkpoint and Circle sign-in diagnostics
802a858 Add Phase 3 frontend handoff
5cac112 Integrate Circle modular wallet sign-in
```

The frontend integration is in `78703c6`; the relayer polling fallback and regression test are committed in `0dfd544`.

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
VITE_CONTRACT_ADDRESS=0xdfe3495a871e17317b50C5B1B688554EE7194037
VITE_CONTRACT_ABI=
VITE_DEPLOYMENT_BLOCK=56139585
VITE_ARC_RPC_URL=https://rpc.testnet.arc.network
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

## Latest live frontend checkpoint

On 2026-08-09, the local frontend was successfully tested at
`http://localhost:5173` with Circle Modular Wallets on Testnet. A passkey
approval on a phone completed sign-in, and the deployed trade agreement loaded
in the UI. This confirms the Client Key, `localhost` Allowed Domain, Passkey
Domain, client URL, and direct passkey integration are operational.

The successful sign-in does not yet prove that every intended participant maps
to an immutable BUYER, SELLER, or ARBITRATOR role, nor that the complete
settlement demo has reached `MINTED`; retain those as the next live gates.

### Frontend loading guard

If sign-in succeeds but the agreement read is delayed by the Arc HTTP provider,
the UI now stops waiting after 60 seconds and shows a plain-language error with
a `Try again` action. Previously the authenticated screen rendered only an
endless `Loading trade agreement…` state because a stalled read had no timeout
and its error was hidden while `data` was empty. The retry uses the current
authenticated account; account-switch and sign-out clearing behavior remains
unchanged.

Verified with `cd frontend && npm run build`, `npm run audit`, and
`git diff --check`. This is a frontend resilience fix only; it does not change
the deployed agreement, contract authorization, relayer settlement flow, or
Gateway integration.

### Frontend RPC correction

The demo browser was still using the stale frontend-only value
`https://rpc.drpc.testnet.arc.io` in `frontend/.env.local`, while the relayer
had already moved to the official Arc HTTP endpoint. This caused sign-in to
complete but agreement reads to fail. `frontend/.env.local` is now aligned to
`https://rpc.testnet.arc.network`. Restart Vite after changing environment
values because Vite reads them at startup.

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

1. ~~Configure a valid Modular Wallet Web Client Key and verify sign-in from
   `http://localhost:5173`.~~ Completed: phone passkey sign-in succeeded and
   the deployed trade agreement loaded.
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

Do not redeploy, modify the contract, or alter Gateway custody as part of Phase
3 completion. The HTTP polling fallback is an operational reliability change;
the relayer's settlement architecture and database lifecycle remain unchanged.

## Critical compatibility check

The deployed agreement authorizes immutable buyer, seller, and arbitrator addresses. A newly created Circle smart-account address must match one of those configured agreement roles to submit permitted actions. If it does not, the frontend will correctly identify the account as READ_ONLY and contract calls will fail authorization. The client key cannot alter agreement roles.

Before the demo, authenticate each intended participant and confirm the displayed role. If the Circle accounts do not match the existing configured roles, Phase 1/2 must provide the compatible account setup or a separately approved agreement configuration; do not change the deployed contract from the frontend.

## Demo decision under deadline

The earlier preferred path was to use the existing deployed agreement with
compatible Circle participant accounts. That was not possible because the
existing participant addresses are not Circle smart-account addresses. The
approved replacement path below is now complete: a separate demo agreement is
deployed and the active frontend/relayer configuration points to it.

## Approved demo pivot

The current Circle account `EDA6...BE30` cannot become one of the immutable
participants in the existing agreement. Registering another passkey only
creates another deterministic account; it cannot select the existing buyer,
seller, or arbitrator address.

The three new demo participant accounts have now been created through the
frontend passkey flow:

```text
Buyer      0xcb3d0d26aa0db45394b35f39b3193d223cb25a9c
Seller     0x864f041ea3c9573a949c4a5f6c21448bbaa565a7
Arbitrator 0xd8b2b10ba38ad9dadddce3cdd23463d39ca25faf
```

These are public account addresses, not signing secrets. They were used as the
inputs for the separately approved demo agreement deployment.

The owner has chosen the practical hackathon path: create three Circle Modular
Wallet passkey accounts for the demo buyer, seller, and arbitrator; record their
generated account addresses; deploy a separate demo agreement configured with
those addresses; then repoint the relayer and frontend to that demo agreement.
The existing agreement remains untouched as the reference deployment.

Demo sequence:

The Client Key/passkey configuration created in Circle Console is not the same
as a participant smart account. Participant accounts are created by the
frontend sign-in flow. The adapter now remembers multiple sign-in names and
logs each generated account address to the development console for deployment
setup; full addresses remain out of rendered UI.

1. ~~Create/authenticate the three Circle accounts and capture their full account
   addresses from the development console without rendering full addresses in
   the product UI.~~ Completed.
2. ~~Set the deployment inputs for buyer, seller, and arbitrator to those
   addresses and deploy the separate demo agreement.~~ Completed:
   `0xdfe3495a871e17317b50c5b1b688554ee7194037`, block `56139585`.
3. ~~Update the relayer contract address and deployment block, rebuild it, and
   verify `curl http://localhost:3001/status` before frontend testing.~~
   Completed; status reports `listening: true`.
4. ~~Update the frontend contract address/deployment block, build and audit it,
   then run the complete buyer, seller, and arbitrator video path.~~ Contract
   configuration and build/audit are complete; role/action E2E remains.
5. Deploy the frontend to Vercel with the demo contract, Arc RPC, relayer URL,
   and Circle Client Key environment variables.

This pivot is intentionally outside the original no-redeployment boundary and
must only target the separately approved demo agreement. Do not overwrite the
original contract address or its settlement database.

## Boundaries preserved

- No frontend deployment or factory flow.
- No Gateway calls from the frontend.
- No BurnIntent, salt, attestation, operator-signature, or private settlement data handling.
- No transfer-hash invention; settlement rows come from relayer event metadata.
- Existing unrelated modifications in `package.json`, `package-lock.json`, and the deployment broadcast file were not included in the frontend commits and should be reviewed by the Phase 1/2 owner separately.

## Resolved live demo incident — relayer RPC subscriptions

The frontend checkpoint has been built and audited successfully. The original
relayer event-subscription blocker has been addressed in the working tree by the
Phase 1/2 relayer owner using explicit HTTP log polling.

Observed sequence on the demo laptop:

1. With `ARC_RPC_URL=https://rpc.drpc.testnet.arc.io` and no WSS, HTTP contract
   validation and relayer initialization succeeded, but the free D-RPC plan
   repeatedly returned `method is not available on free plan` for the filter
   polling requests. Live settlement event subscriptions are therefore not
   reliable on that endpoint.
2. The local `.env` was then changed to the official Arc endpoints:

   ```dotenv
   ARC_RPC_URL=https://rpc.testnet.arc.network
   ARC_WSS_URL=wss://rpc.testnet.arc.network
   ```

   HTTP validation succeeded intermittently, but the WebSocket connection
   returned `AggregateError [ETIMEDOUT]`; the relayer then exited during event
   source startup and logged `WebSocket disconnected — reconnecting...`.

The D-RPC filter limitation and official Arc WSS timeout are no longer startup
requirements because the relayer uses HTTP polling. The remaining live gate is
to start the relayer against an Arc HTTP endpoint that permits `eth_getLogs`
and confirm `/status` responds on port 3001. The fallback and tests are
committed, but the latest execution environment could not resolve
`rpc.testnet.arc.network` (`getaddrinfo EAI_AGAIN`), so the relayer exited before
opening port 3001 and live `/status` was not confirmed here.

### Latest laptop result

The demo laptop now resolves the official hostname and reaches the RPC: startup
validation succeeded on attempt 1. However, the relayer still exited before
opening port 3001:

```text
getent hosts rpc.testnet.arc.network
2606:4700::6812:1e3d rpc.testnet.arc.network
2606:4700::6812:1f3d rpc.testnet.arc.network

Startup validation succeeded
Relayer startup failed {"error":"AggregateError","code":"ETIMEDOUT"}
```

`curl http://localhost:3001/status` consequently returned connection refused.
This failure occurs after contract validation, during the post-validation
initialization path—most likely the historical `eth_getLogs` sweep or its
provider connection—not during the removed WebSocket subscription path.

The Phase 1/2 owner should instrument or retry the historical sweep with the
block range in its error log, verify a valid `eth_getLogs` request against the
selected Arc HTTP endpoint, and then rerun the status check. Do not mark the
relayer live until `/status` remains available.

The relayer now prefers IPv4 for Arc RPC DNS resolution, and each historical
block/log request retries three times with its block range in the diagnostic
log. This addresses transient Node address-family and RPC connection failures
without skipping historical events.

The transport fix is implemented in `relayer/src/index.ts` using ethers'
`FetchRequest.registerGetUrl` with a native Node HTTPS agent configured for
`family: 4`; the settlement executor therefore receives the same IPv4-only
transport as the read provider. A clean disposable verification should use a
separate `RELAYER_PORT` if an interrupted local run may have left port 3001
occupied.

## Relayer HTTP fallback

The relayer now uses explicit HTTP `eth_getLogs` polling through the existing
`LogProvider` instead of depending on WebSocket subscriptions at process
startup. Polling begins after the historical sweep cursor, uses bounded 500
block windows, retries provider errors without exiting, and stops cleanly with
the relayer. The existing database settlement deduplication and Gateway
settlement flow are unchanged. `ARC_WSS_URL` is retained as compatible
configuration but is no longer required for event delivery.

Verification completed after the change:

```sh
npm run build
npm test
```

Both pass, including a regression test for block-cursor polling and topic
dispatch. The remaining live gate is to run the relayer against an Arc HTTP
endpoint that permits `eth_getLogs`, confirm `/status` stays available on port
3001, and then repeat the Circle/frontend demo. If the selected provider
rejects `eth_getLogs` entirely, a provider/API plan that permits log queries is
still required; the fallback cannot compensate for an endpoint-level denial.
