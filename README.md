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
| Local frontend | <http://localhost:5173> |
| Local relayer and proposal registry | <http://localhost:3001> |
| Arc RPC | <https://rpc.testnet.arc.network> |
| Factory | `0x83720927588845e7e5c6d12d73eccb39ace7c9bb` |
| Factory deployment block | `56261623` |
| Reference escrow deployment | `0xc36a8ca590405fa7c9df44c46ff784a33530a4b0` |
| Reference escrow deployment block | `56256269` |
| Arc Testnet USDC used by the app | `0x3600000000000000000000000000000000000000` |

The factory address, ABI, event topics, and deployment blocks are also stored
in the generated `config.json` and `relayer/config.json`. Treat those files as
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

1. The initiating party records the goods, route, delivery terms, parties, and
   settlement parameters.
2. The parties exchange milestone proposals through the PostgreSQL registry.
3. The UI shows proposal versions and field-level differences for counteroffers.
4. Both parties accept the same milestone plan.
5. The buyer creates the on-chain escrow through the factory.
6. The backend verifies the deployment transaction and records the contract
   address and deployment block.
7. The existing on-chain milestone runner takes over.

The commercial registry does not hold settlement funds and does not deploy the
contract. It stores the negotiation record and verifies the resulting Arc
deployment.

### On-chain settlement workflow

Each factory-created escrow clone stores the buyer, seller, arbitrator,
operator, total USDC amount, deadlines, and milestone rules. Its lifecycle is:

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
rewrites `config.json` and `relayer/config.json`.

### 3. Configure and start the frontend

Create `frontend/.env.local`:

```dotenv
VITE_ARC_RPC_URL=https://rpc.testnet.arc.network
VITE_FACTORY_ADDRESS=0x83720927588845e7e5c6d12d73eccb39ace7c9bb
VITE_FACTORY_DEPLOYMENT_BLOCK=56261623
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
FRONTEND_ORIGIN=http://localhost:5173
CIRCLE_WALLET_AUTH_SECRET=<openssl rand -hex 32>
```

Apply all migrations, then start the API:

```sh
cd backend
npm run migrate
npm run dev
```

`npm run migrate` applies the three migrations in order:

1. `001_trade_agreements.sql` — agreement and proposal tables.
2. `002_wallet_auth.sql` — one-time wallet challenges.
3. `003_commercial_corrections.sql` — current status transitions and
   commercial corrections.

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
| `GATEWAY_API_BASE_URL` | No | Defaults to Circle Testnet Gateway API |
| `RELAYER_PRIVATE_KEY` | Yes | Server-only key for burn-intent authorization and minting |
| `OPERATOR_PRIVATE_KEY` | Fallback | Legacy alias accepted when `RELAYER_PRIVATE_KEY` is absent |
| `SQLITE_PATH` | No | Defaults to `./relayer.db`; use a mounted volume in production |
| `PORT` / `RELAYER_PORT` | No | Defaults to `3001`; platforms commonly provide `PORT` |
| `COMMERCIAL_REGISTRY_URL` | No | Backend URL for internal on-chain state callbacks |
| `COMMERCIAL_REGISTRY_INTERNAL_TOKEN` | No | Shared secret for those callbacks |

### Frontend (`frontend/.env.local`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_ARC_RPC_URL` | Yes | Browser contract reads |
| `VITE_FACTORY_ADDRESS` | No | Overrides generated factory address |
| `VITE_FACTORY_DEPLOYMENT_BLOCK` | No | Overrides generated factory scan start block |
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

### Relayer on Render

`render.yaml` and `relayer/Render.Dockerfile` provide an alternative relayer
deployment. Configure the same secrets and attach a persistent disk at
`/data`, with `SQLITE_PATH=/data/relayer.db`. Do not run two production
relayers against the same settlement workload unless you have deliberately
designed for duplicate coordination.

### Commercial API on Render or another Docker host

The commercial API is packaged by `backend/Dockerfile`. Provide a managed
PostgreSQL database and configure `DATABASE_URL`, `DATABASE_SSL`,
`FRONTEND_ORIGIN`, `ARC_RPC_URL`, and `CIRCLE_WALLET_AUTH_SECRET`. Run the
migrations once against the production database before serving traffic. Then
set the API's HTTPS URL as `VITE_AGREEMENT_API_URL` in the frontend deployment.

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
  transient Gateway failures. A transfer whose Gateway outcome is unknown is
  marked for manual recovery rather than blindly submitted again.
- `config.json` and `relayer/config.json` are generated from deployment
  broadcasts. Regenerate them after contract changes or a new deployment.
- The frontend uses Arc Testnet chain ID `5042002`; do not point it at a
  different chain without regenerating deployment configuration and reviewing
  Gateway addresses.

## Submission material

The `submission/` directory contains the project PDF and supporting assets. It
is separate from runtime configuration and should not be used as a deployment
input.
