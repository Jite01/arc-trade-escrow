# Arc Trade Escrow

Arc Trade is a documentary trade workflow for Arc Testnet. It turns an
agreement between commercial parties into an executable, milestone-based USDC
settlement contract.

The project combines:

- Circle Modular Wallet passkeys and smart accounts for participant access and
  sponsored transactions.
- A factory and clone-based Solidity escrow system on Arc Testnet.
- A React/Vite trade desk for company access, proposals, negotiation, funding,
  evidence, release, disputes, and settlement status.
- A TypeScript relayer that watches escrow events, authorizes Gateway burn
  intents, submits Circle Gateway transfers, and mints returned attestations.
- An optional Express/PostgreSQL commercial registry for the richer pre-contract
  agreement workflow.

The contract is the source of truth for on-chain terms, authorization, funds,
milestones, and settlement state. The browser never calls Circle Gateway
directly and never receives the relayer's private key.

## Current deployment

The active demo targets Arc Testnet, chain ID `5042002`.

| Component | Address / URL |
| --- | --- |
| Frontend | <https://arc-trade-escrow.vercel.app> |
| Hosted relayer and proposal registry | <https://arc-trade-escrow-relayer-production-56a0.up.railway.app> |
| Commercial registry backend | <https://arc-trade-commercial-registry-production.up.railway.app> |
| Relayer failover host B | <https://arc-trade-escrow-relayer-b-production.up.railway.app> |
| Local frontend | <http://localhost:5173> |
| Local relayer and proposal registry | <http://localhost:3001> |
| Arc RPC | <https://rpc.testnet.arc.network> |
| Legacy demo factory | `0x83720927588845e7e5c6d12d73eccb39ace7c9bb` |
| Legacy factory deployment block | `56261623` |
| Resolution Router | `0xa2110cfa087542bdf67b8774b0ed064f4d080755` |
| Router-backed testnet factory | `0xc0d427ee142d5e74be2a5805e0924adea3e2a2c2` |
| Router-backed testnet factory deployment block | `58181125` |
| Reference escrow deployment | `0xc36a8ca590405fa7c9df44c46ff784a33530a4b0` |
| Reference escrow deployment block | `56256269` |
| Arc Testnet USDC used by the app | `0x3600000000000000000000000000000000000000` |

The factory address, Router address, ABI, event topics, and deployment blocks are
also stored in the generated `config.json`, `frontend/config.json`, and
`relayer/config.json`. Treat those files as
deployment artifacts, not hand-maintained application configuration.

## Product flows

### Public and authenticated frontend

- `/` is the public product landing page.
- `/login` is the standalone Arc Trade passkey sign-in page.
- `/login?mode=register` starts company access creation.
- `/signin/...` handles private proposal invitations and preserves the invited
  company context.
- `/` after authentication is the trade desk: company profile, proposal board,
  incoming invitations, live agreements, and test-funds controls.
- `/agreements/new` is the commercial agreement workflow for capturing goods,
  transport, delivery terms, financial terms, participants, and milestones.

The login page is intentionally separate from the marketing landing page. A
company name identifies the profile; the device passkey is the credential. No
password is stored by the frontend.

### Commercial agreement workflow

The commercial workflow is the pre-contract negotiation layer:

1. The initiating party records the goods, route, delivery terms, parties,
   resolution policy, and settlement parameters. The escrow arbitration address
   is always the configured Resolution Router; a resolver wallet is optional
   policy metadata and can remain unset until the dispute workflow.
2. The parties exchange milestone proposals through the PostgreSQL registry.
3. The UI shows proposal versions and field-level differences for counteroffers.
4. Both parties accept the same milestone plan.
5. The buyer creates the on-chain escrow through a router-backed factory. The
   frontend first checks the factory's immutable arbitration authority.
6. The backend verifies the deployment transaction, factory, router, escrow
   terms, and records the contract address and deployment block.
7. The existing on-chain milestone runner takes over.

The commercial registry does not hold settlement funds and does not deploy the
contract. It stores the negotiation record and verifies the resulting Arc
deployment.

### Frozen resolution architecture

Future production escrows must be created by a factory whose immutable
`arbitrator` constructor value is the deployed `ResolutionRouter`. The factory
and escrow ABI remain unchanged; the legacy demo factory above is not a
router-backed deployment. The router is the on-chain arbitration authority,
while the case resolver is selected in the commercial/resolution layer and
authorized with the Router's buyer, seller, and resolver signatures.

```text
Agreement → Resolution Policy → Router-backed Escrow → Resolution Router
          → Escrow arbitration → Relayer → Gateway → Settlement
```

The nominated resolver is metadata until the Router verifies the exact
escrow/milestone case and signed decision. The Router does not hold funds,
discover resolvers, or submit Gateway transfers.

The Router uses one signed authorization model for both ArcTrade's default
resolver and mutually selected resolvers. Buyer, seller, and resolver sign an
assignment; the resolver separately signs the recipient decision. EOA
signatures use strict low-s ECDSA recovery and smart accounts use ERC-1271.
The case identity is:

```text
caseId = keccak256(abi.encode(chainId, router, escrow, milestoneIndex))
```

This matches the current one-shot dispute semantics. A future escrow that
permits repeated disputes for one milestone needs an explicit dispute nonce and
a new case schema. See [RESOLUTION_ROUTER.md](RESOLUTION_ROUTER.md) for the
full authorization model.

### On-chain settlement workflow

Each factory-created escrow clone stores the buyer, seller, fixed Router
arbitration authority, operator, total USDC amount, deadlines, and milestone
rules. Its lifecycle is:

1. Propose and approve a milestone array.
2. Commit the agreement and deposit USDC into the escrow/Gateway flow.
3. Trigger milestones with document hashes.
4. Confirm, dispute, release, arbitrate, or force-release according to role and
   deadline.
5. Reclaim funds after an eligible expiry.
6. Record a `BurnIntentAuthorized` event for each releasable settlement.
7. Let the relayer complete the Gateway transfer and attestation mint.

The contracts enforce role and state transitions. The frontend only exposes
actions allowed by the current participant role and contract state.

### Live Gateway findings

Disposable Arc Testnet validation used a fresh Router-backed escrow and
confirmed:

- the unchanged escrow accepts the Resolution Router as `arbitrationAddress`;
- the escrow's ERC-1271 contract-signer response changes from invalid to valid
  after `authorizeBurnIntent`;
- Gateway accepts different salts for the same escrow, recipient, and amount;
- Gateway therefore does not enforce ArcTrade's logical settlement identity;
- the relayer must enforce one settlement per `(escrow, settlementIndex)`,
  persist one burn intent/salt, and never blind-replace an uncertain submission;
- pending Gateway intents reserve liquidity and must be reconciled before any
  retry or replacement decision.

The live harness is disposable and operational only; its experimental behavior
is not part of production logic. The relayer validates the live escrow
settlement, `BurnIntentAuthorized` event, Gateway fee reserve, and block-height
before submission.

## Architecture

```text
                         Arc Trade frontend
                    React + Vite + TypeScript
             /              |                 \
            /               |                  \
   Circle passkey       Relayer API       Commercial API
   smart account        port 3001         port 4000
        |                    |                  |
        |                    |                  +-- PostgreSQL
        |                    +-- SQLite         |
        |                    +-- Arc event poll |
        |                    +-- Circle Gateway |
        |                    |                  |
        +--------------------+------------------+
                             |
                    Arc Testnet contracts
                 Factory + escrow clone per trade
```

### Responsibilities and data boundaries

| Layer | Owns | Does not own |
| --- | --- | --- |
| Frontend | UI state, passkey session, user-triggered transactions, read views | Gateway credentials, relayer private key, authoritative settlement state |
| Escrow contracts | Terms, roles, funds, milestones, deadlines, authorization, settlement events | Company names, proposal prose, browser sessions |
| Relayer / SQLite | Company profiles, simple proposals, event cursor, Gateway settlement lifecycle | Commercial negotiation source documents and passwords |
| Commercial API / PostgreSQL | Rich agreement drafts, proposals, diffs, wallet-authenticated access, deployment verification | Escrow funds, Gateway transfers, contract writes |

The relayer's SQLite file must be persistent in production. It contains the
proposal/company registry and settlement recovery state. The commercial API
requires persistent PostgreSQL storage.

## Repository layout

```text
src/                    Solidity escrow and factory contracts
test/                   Foundry contract tests and mocks
script/                 Foundry deployment scripts
frontend/               React/Vite trade desk and commercial workflow
relayer/                Gateway relayer, SQLite registry, and HTTP API
backend/                Express/PostgreSQL commercial agreement API
scripts/                Operational scripts for activation and settlement tests
shared/                 Shared TypeScript/domain terms
submission/             Submission PDF and supporting assets
config.json             Generated deployed contract ABI/address configuration
regenerate-config.sh    Rebuilds config.json files from Foundry deployments
```

## Prerequisites

- Node.js `>=20.6`.
- npm.
- Foundry (`forge`, `cast`) for contract builds, tests, and deployments.
- PostgreSQL if using `/agreements/new`.
- A Circle Modular Wallet Web Client Key for browser passkey access.
- An Arc Testnet RPC endpoint and test USDC for end-to-end use.

## Local development

There are three services, but only the relayer and frontend are required for
the basic proposal/on-chain demo. The PostgreSQL backend is required for the
commercial agreement workflow.

### 1. Install dependencies

```sh
# repository root: relayer
npm install

# frontend
cd frontend
npm install

# optional commercial API
cd ../backend
npm install
```

### 2. Start the relayer and proposal registry

From the repository root:

```sh
cp .env.example .env
```

Set at least these values in `.env`:

```dotenv
ARC_RPC_URL=https://rpc.testnet.arc.network
GATEWAY_API_BASE_URL=https://gateway-api-testnet.circle.com
RELAYER_PRIVATE_KEY=<server-side relayer key>
SQLITE_PATH=./relayer.db
```

Then build and start it:

```sh
npm run build
npm start
```

The default port is `3001`. For a watch-mode process, use `npm run dev`.

The relayer reads its contract addresses, ABIs, and event topics from
`config.json`. If the contracts have been redeployed, regenerate both config
files with:

```sh
./regenerate-config.sh
```

That script expects Foundry broadcast output for the Arc Testnet deployment and
rewrites all three generated manifests. Set `RESOLUTION_ROUTER_ADDRESS` when
running it; a Router address is required for a production factory manifest.

### 3. Configure and start the frontend

Create `frontend/.env.local`:

```dotenv
VITE_ARC_RPC_URL=https://rpc.testnet.arc.network
VITE_FACTORY_ADDRESS=0xc0d427ee142d5e74be2a5805e0924adea3e2a2c2
VITE_FACTORY_DEPLOYMENT_BLOCK=58181125
VITE_RESOLUTION_ROUTER_ADDRESS=0xa2110cfa087542bdf67b8774b0ed064f4d080755
VITE_RELAYER_BASE_URL=http://localhost:3001

# Required for Circle passkey sign-in
VITE_CLIENT_KEY=<Circle Modular Wallet Web Client Key>
VITE_CLIENT_URL=https://modular-sdk.circle.com/v1/rpc/w3s/buidl

# Required when using the commercial workflow locally
VITE_AGREEMENT_API_URL=http://localhost:4000
VITE_OPERATOR_ADDRESS=0x0bF9683D68c79976281A6a16CFb9A49608a1a37c
```

Configure the Circle Client Key for the origin you are using. For local
development, the Allowed Domain and Passkey Domain must match `localhost`.
The key is browser configuration, but it is still environment-specific and
must not be committed.

Start the Vite app:

```sh
cd frontend
npm run dev
```

Vite reads environment variables at startup, so restart it after changing
`.env.local`.

### 4. Optional: start the commercial API

Create `backend/.env` from `backend/.env.example` and configure PostgreSQL:

```dotenv
DATABASE_URL=postgres://postgres:postgres@localhost:5432/arc_trade
DATABASE_SSL=false
PORT=4000
ARC_RPC_URL=https://rpc.testnet.arc.network
RESOLUTION_ROUTER_ADDRESS=<deployed-resolution-router-address>
FACTORY_ADDRESS=<router-backed-factory-address>
FRONTEND_ORIGIN=http://localhost:5173
CIRCLE_WALLET_AUTH_SECRET=<openssl rand -hex 32>
```

Apply all migrations, then start the API:

```sh
cd backend
npm run migrate
npm run dev
```

`npm run migrate` applies the four migrations in order:

1. `001_trade_agreements.sql` — agreement and proposal tables.
2. `002_wallet_auth.sql` — one-time wallet challenges.
3. `003_commercial_corrections.sql` — current status transitions and
   commercial corrections.
4. `004_resolution_policy.sql` — Router-backed resolution policy metadata.

The API exposes `/healthz`, wallet challenge/verification endpoints, and the
authenticated `/agreements` resources. The frontend obtains a short-lived
token by signing a challenge with the Circle smart account. The backend
verifies that signature through EIP-1271; it does not trust an unsigned wallet
address supplied by the browser.

## Environment reference

### Relayer (`.env` at the repository root)

| Variable | Required | Purpose |
| --- | --- | --- |
| `ARC_RPC_URL` | Yes | Arc Testnet JSON-RPC endpoint |
| `ARC_WSS_URL` | No | Optional; HTTP log polling remains the resilient event path |
| `FACTORY_ADDRESS` | No | Optional assertion against the generated Router-backed factory |
| `RESOLUTION_ROUTER_ADDRESS` | No | Optional assertion against the generated Router address |
| `CONFIRMATION_DEPTH` | No | Blocks required before events enter settlement processing; defaults to `12` |
| `REORG_LOOKBACK_BLOCKS` | No | Historical overlap used to replay logs after a short reorg; defaults to `48` |
| `GATEWAY_API_BASE_URL` | No | Defaults to Circle Testnet Gateway API |
| `RELAYER_PRIVATE_KEY` | Yes | Server-only key for burn-intent authorization and minting |
| `OPERATOR_PRIVATE_KEY` | Fallback | Legacy alias accepted when `RELAYER_PRIVATE_KEY` is absent |
| `SQLITE_PATH` | No | Defaults to `./relayer.db`; use a mounted volume in production |
| `PORT` / `RELAYER_PORT` | No | Defaults to `3001`; platforms commonly provide `PORT` |
| `COMMERCIAL_REGISTRY_URL` | No | Backend URL for internal on-chain state callbacks |
| `COMMERCIAL_REGISTRY_INTERNAL_TOKEN` | No | Shared secret for those callbacks |

### Commercial API (`backend/.env`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `RESOLUTION_ROUTER_ADDRESS` | Yes | Fixed on-chain arbitration authority |
| `FACTORY_ADDRESS` | Yes | Router-backed factory checked during deployment verification |
| `ARC_RPC_URL` | Yes | Arc Testnet RPC used for deployment verification |
| `ARC_CHAIN_ID` | No | Expected chain ID; defaults to Arc Testnet `5042002` |
| `PLATFORM_OPERATOR_ADDRESS` / `OPERATOR_ADDRESS` | Yes | Existing escrow settlement operator |
| `CIRCLE_WALLET_AUTH_SECRET` | Yes | Server-only wallet challenge secret |

### Frontend (`frontend/.env.local`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_ARC_RPC_URL` | Yes | Browser contract reads |
| `VITE_FACTORY_ADDRESS` | No | Overrides generated factory address |
| `VITE_FACTORY_DEPLOYMENT_BLOCK` | No | Overrides generated factory scan start block |
| `VITE_RESOLUTION_ROUTER_ADDRESS` | Commercial flow | Displays the fixed arbitration authority |
| `VITE_RELAYER_BASE_URL` | No | Relayer and proposal registry URL |
| `VITE_AGREEMENT_API_URL` | Commercial flow | PostgreSQL commercial API URL |
| `VITE_OPERATOR_ADDRESS` | Commercial flow | Operator enforced by the backend and deployment form |
| `VITE_CLIENT_KEY` | Passkey flow | Circle Modular Wallet Web Client Key |
| `VITE_CLIENT_URL` | Passkey flow | Circle Modular Wallet RPC endpoint |

All `VITE_*` values are exposed to the browser bundle. Never put private keys,
Gateway secrets, database credentials, or bearer-token signing secrets in
frontend environment variables.

## HTTP endpoints

### Relayer and proposal registry

The relayer serves JSON over HTTP with permissive CORS for the demo frontend.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | Process health, including bootstrap health during configuration failures |
| `GET` | `/status` | Relayer readiness, factory address, uptime, and settlement counts |
| `GET` | `/transfers` | All settlement lifecycle rows |
| `GET` | `/transfers/:key` | One settlement row |
| `GET` | `/settlements/:key` | Alias for one settlement row |
| `GET` | `/companies/lookup?name=...` | Find a company by normalized name |
| `GET` | `/companies/by-wallet?address=...` | Find a company by wallet |
| `POST` | `/companies` | Register a company profile |
| `GET` | `/proposals/public` | Current public proposals |
| `GET` | `/proposals/company/:slug` | Proposals associated with a company |
| `GET` | `/proposals/:id` | One proposal or invitation |
| `POST` | `/proposals` | Create a proposal |
| `POST` | `/proposals/:id/accept` | Accept a proposal |
| `POST` | `/proposals/:id/bind` | Bind an accepted proposal to an escrow |
| `DELETE` | `/proposals/:id` | Remove an expired proposal |

The proposal endpoints are application-level registry operations. They do not
replace on-chain authorization.

### Commercial API

The backend exposes:

- `GET /healthz`
- `POST /auth/challenge`
- `POST /auth/verify`
- `POST /agreements`
- `GET /agreements/:id`
- `PATCH /agreements/:id`
- `GET /agreements/:id/proposals`
- `POST /agreements/:id/proposals`
- `POST /agreements/:id/accept`
- `GET /agreements/:id/diff/:proposalId`
- `POST /agreements/:id/deploy-intent`
- `POST /agreements/:id/deployment-confirmation`

Agreement resources require a bearer token issued by the wallet challenge
flow. The internal `/internal/...` callbacks are reserved for the relayer and
require `COMMERCIAL_REGISTRY_INTERNAL_TOKEN`.

## Deployment

### Frontend on Vercel

Set the Vercel project root to `frontend/`. The existing `frontend/vercel.json`
builds the Vite app and rewrites direct SPA routes such as `/login`,
`/signin/...`, and `/agreements/new` to `index.html`.

Configure Preview and Production with the frontend variables above. In Circle
Console, add the Vercel hostname as both the Allowed Domain and Passkey Domain
for the Client Key. The relayer URL must be public HTTPS; it is not a Circle
passkey domain.

### Relayer on Railway

The repository includes `railway.json` and `relayer/Railway.Dockerfile`.
Configure `ARC_RPC_URL`, `GATEWAY_API_BASE_URL`, and
`RELAYER_PRIVATE_KEY`. Mount persistent storage for `SQLITE_PATH`, normally
`/data/relayer.db`, and use the generated HTTPS domain as
`VITE_RELAYER_BASE_URL`.

Railway supplies `PORT`; the relayer honors it automatically. Use `/healthz`
for platform health checks and `/status` to confirm that initialization has
completed.

The current distributed test deployment uses two separate Railway services,
with stable IDs `arc-relayer-a` and `arc-relayer-b`, coordinated through the
commercial registry's PostgreSQL-backed claim table. Historical discovery runs
in the background with bounded RPC requests controlled by `RPC_LOG_CHUNK_SIZE`
and retries after transient RPC failures, so readiness is not blocked by a
slow historical sweep. Confirm the sweep has caught up before relying on the
service for older settlements.

### Relayer on Render

`render.yaml` and `relayer/Render.Dockerfile` provide an alternative relayer
deployment. Configure the same secrets and attach a persistent disk at
`/data`, with `SQLITE_PATH=/data/relayer.db`. Do not run two production
relayers against the same settlement workload unless you have deliberately
designed for duplicate coordination.

### Commercial API on Render or another Docker host

The commercial API is packaged by `backend/Dockerfile`. Provide a managed
PostgreSQL database and configure `DATABASE_URL`, `DATABASE_SSL`,
`FRONTEND_ORIGIN`, `ARC_RPC_URL`, `RESOLUTION_ROUTER_ADDRESS`,
`FACTORY_ADDRESS`, and `CIRCLE_WALLET_AUTH_SECRET`. Run the migrations once
against the production database before serving traffic. Then set the API's
HTTPS URL as `VITE_AGREEMENT_API_URL` in the frontend deployment.

### Router-backed factory deployment

Deploy the Router first, then deploy a new factory with
`RESOLUTION_ROUTER_ADDRESS` set. The existing factory contract is unchanged;
only its immutable constructor value determines whether its clones are
Router-backed. Do not point the commercial API or frontend at the legacy demo
factory. The deployment scripts are:

```sh
forge script script/DeployResolutionRouter.s.sol:DeployResolutionRouter --rpc-url "$ARC_RPC_URL" --broadcast
forge script script/DeployDocumentaryTradeEscrowFactory.s.sol:DeployDocumentaryTradeEscrowFactory --rpc-url "$ARC_RPC_URL" --broadcast
```

The current disposable deployment is recorded above. Its deployment transaction
is `0xe68c9f11ea2d27cda687b230829564b31db890e541f144b98159ab713a3d4c13`, sent
by `0x5a3b38f486c75444174dc88967ef8de0014134ac`. The deployed factory's
immutable `arbitrator()` was read on-chain and matched the Router. After any
future deployment, set the new Router and factory addresses in backend and
frontend environments, regenerate all manifests, and record the factory block.

### Live Router, relayer, and Gateway validation

The disposable Arc Testnet failover run completed the full path:

```text
agreement → factory deployment → funding → milestone approval
          → trigger → dispute → Router resolution → relayer → Gateway settlement
```

The test used a fresh escrow, not the legacy reference escrow. The key evidence
was:

| Step | Transaction / identifier |
| --- | --- |
| Agreement creation | `0x66d5fb0784cd275438ee01961aa3f0d159ab6bdcdeb4341c48bafc2e71abc8b` |
| Dispute | `0xd04ad5f435469419321161a0cacbf5f44f0f6f0728032b480542971996013369` |
| Router resolution | `0x4a3c3b53354d5be6f4d616698111c77f8d4d5d11f0a4955ee886874a3ef51540` |
| Escrow burn-intent authorization | `0x5f05fef4580c24b282570e6ed7af34b5b26b8ba0d4b4796526c16e43630c1cae` |
| Gateway transfer ID | `504acd8e-c6f2-4ac6-a310-272343e1fe11` |
| Finalized Gateway settlement | `0x6a02ac0604a86bfefc969b50f7d3eafbeff97837cb1ddb1ac1780a49a7c3e26f` |

Relayer A was interrupted during settlement and relayer B recovered the same
logical settlement. Gateway reported `finalized`; exactly one transfer was
minted, using the persisted burn intent and deterministic salt. The Gateway fee
was `0.0035 USDC`. This validates failover and idempotency for this scenario;
it does not make Gateway enforce ArcTrade's logical uniqueness rule.

## Testing and checks

Run the relevant checks from the repository root:

```sh
# Solidity unit tests
forge test

# Relayer TypeScript tests
npm test

# Relayer typecheck/build
npm run build

# Commercial API tests and build
cd backend
npm test
npm run build

# Frontend build and rendered-language audit
cd ../frontend
npm run build
npm run audit
```

The frontend audit scans rendered text and selected attributes for forbidden
or accidental product language. It is intentionally separate from the
TypeScript build.

## Operational notes

- Use a persistent SQLite volume for the relayer. Losing it removes proposal
  and company records and can remove settlement recovery history.
- Keep `RELAYER_PRIVATE_KEY`, `CIRCLE_WALLET_AUTH_SECRET`, database URLs, and
  deployment keys outside the repository.
- The relayer resumes non-terminal settlement rows after restart and retries
  transient Gateway failures. Settlement rows are keyed by
  `(escrow, settlementIndex)` and protected by a persistent lease. A transfer
  whose Gateway outcome is unknown is marked `RECONCILIATION_REQUIRED` rather
  than blindly submitted again. Known transfer IDs are recovered through the
  Gateway status endpoint; pending intents are persisted and retried without a
  new salt.
- A persisted burn intent is written before authorization/submission, and its
  exact salt, fee, block height, recipient, and amount are reused across
  restart/retry. `SUBMITTING`, `GATEWAY_PENDING`, and
  `RECONCILIATION_REQUIRED` are operational recovery states, not replacement
  authorization paths.
- Gateway accepts distinct salts for otherwise identical transfers. Logical
  uniqueness is therefore an ArcTrade relayer invariant, not a Gateway
  invariant. The operator key remains capable of direct contract
  authorization; production monitoring and key controls must protect that
  boundary.
- `config.json`, `frontend/config.json`, and `relayer/config.json` are generated
  from deployment broadcasts. Regenerate them after contract changes or a new
  deployment.
- Settlement events are processed only after `CONFIRMATION_DEPTH` blocks. The
  source block hash is persisted; if a later reconciliation observes that the
  source block changed, the row is moved to `RECONCILIATION_REQUIRED` and is
  never automatically paid again.
- The frontend uses Arc Testnet chain ID `5042002`; do not point it at a
  different chain without regenerating deployment configuration and reviewing
  Gateway addresses.

## Readiness boundaries

The repository has local contract, relayer, backend, and frontend coverage,
including a factory-created Router-to-escrow resolution test. The live Gateway
evidence comes from the disposable Arc Testnet harness described above. Before
production or mainnet use:

- deploy and configure a fresh Router-backed factory;
- provide the commercial resolution service that collects resolver assignment
  and decision signatures for each disputed case;
- for one host, use one persistent shared SQLite database; for separate hosts,
  use `RELAYER_COORDINATION_MODE=distributed` with the PostgreSQL-backed
  commercial registry coordination endpoints and a stable instance ID;
- treat distributed claims as fail-closed: a crash or unknown Gateway outcome
  keeps the logical settlement claimed until reconciliation, rather than
  allowing a second host to create another intent;
- define monitoring and manual procedures for unknown Gateway submissions,
  pending liquidity reservations, operator key failure, and Gateway status
  drift.

### Relayer incident recovery

Distributed claims are deliberately fail-closed. If a relayer host dies while a
settlement is in progress, stop or quarantine the old host before recovery.
Use the persisted `(escrow, settlementIndex)` row and burn-intent salt as the
source of truth; never generate a replacement salt.

For an unknown Gateway submission:

1. Do not retry the POST and do not authorize a second intent.
2. If a transfer ID was returned or persisted, query the Gateway transfer
   endpoint until it is finalized, rejected, or definitively absent.
3. Compare the Gateway transfer specification with the escrow's recorded
   recipient, amount, source escrow, and persisted burn intent.
4. If finalized, record/reconcile the mint and mark the logical settlement
   complete. If rejected or definitively absent, requeue the same persisted
   intent and salt only after confirming that no executable transfer remains.
5. If the outcome cannot be established, leave the row in
   `RECONCILIATION_REQUIRED` and escalate; pending transfers reserve liquidity.

After an operator has completed that Gateway reconciliation and confirmed the
old host is stopped, release only the affected distributed claim from the
commercial registry database, for example:

```sql
DELETE FROM relayer_settlement_claims
WHERE logical_settlement_key = '<escrow-lowercase>:<milestone-index>'
  AND completed_at IS NULL;
```

The replacement host may then replay the on-chain settlement event. It must
reuse the persisted burn intent if one exists. This SQL is an incident action,
not an automated lease-expiry mechanism.

For a deep reorg, stop settlement processing, compare the persisted source
block hash with the canonical chain, and verify the escrow's current milestone
state and any Gateway transfer status. Rows marked `RECONCILIATION_REQUIRED`
must not be paid automatically. Reconcile a finalized Gateway transfer against
the canonical escrow result; otherwise requeue only after the canonical chain
proves the settlement is still valid and the previous intent is not executable.
Keep the original row, transaction hash, block hashes, Gateway response, and
operator decision in the incident record.

## Submission material

The `submission/` directory contains the project PDF and supporting assets. It
is separate from runtime configuration and should not be used as a deployment
input.
