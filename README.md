# Arc Trade Escrow

Arc Trade Escrow is a documentary trade agreement on Arc Testnet. Buyer and
seller actions are authorized by `DocumentaryTradeEscrow`; Circle Modular
Wallet passkeys provide user-controlled smart accounts; and a TypeScript
relayer executes contract-authorized Circle Gateway settlements.

The frontend never calls Gateway and never handles private settlement data.
The contract is the source of truth for agreement state and authorization.

## Active demo

- Network: Arc Testnet (`5042002`)
- Agreement factory/registry: `0x83720927588845e7e5c6d12d73eccb39ace7c9bb`
- Factory deployment block: `56261623`
- Hosted frontend: `https://arc-trade-escrow.vercel.app`
- Local frontend: `http://localhost:5173`
- Local relayer API: `http://localhost:3001`

The frontend is a small agreement registry, not a marketplace. A company
creates a private invitation or public proposal; after the recipient accepts,
the factory deploys one escrow clone and indexes it for both participants.
Each participant then sees role-specific controls for funding, milestones,
disputes, release, and relayer settlement.

The submission package contains the architecture diagram and judge-facing
project summary in `submission/`.

## Products and components

- Circle Modular Wallets: passkey authentication, smart accounts, bundler transport, and gas sponsorship.
- Circle Gateway: custody movement and settlement attestation.
- Arc Testnet: agreement and settlement contracts.
- React/Vite/TypeScript frontend: agreement UI and permitted user actions.
- TypeScript relayer: event polling, BurnIntent authorization, Gateway submission/recovery, and SQLite lifecycle state.

## Local development

Install root dependencies and configure the root `.env` with the required RPC,
relayer, Gateway, and signing values. Never commit `.env` or private keys.

Start the relayer from the repository root:

```sh
./regenerate-config.sh
npm install
npm run build
npm start
```

Configure `frontend/.env.local`:

```dotenv
VITE_FACTORY_ADDRESS=0x83720927588845e7e5c6d12d73eccb39ace7c9bb
VITE_FACTORY_DEPLOYMENT_BLOCK=56261623
VITE_ARC_RPC_URL=https://rpc.testnet.arc.network
VITE_RELAYER_BASE_URL=http://localhost:3001
VITE_CLIENT_KEY=<Circle Modular Wallet Web Client Key>
VITE_CLIENT_URL=https://modular-sdk.circle.com/v1/rpc/w3s/buidl
```

The Client Key must be created under Circle Modular Wallets. Configure the
entity, `localhost` as the web Allowed Domain, and `localhost` as the Passkey
Domain. Keep the key only in `frontend/.env.local`.

Start the frontend in a second terminal:

```sh
cd frontend
npm install
npm run dev
```

For a production build and rendered-language check:

```sh
cd frontend
npm run build
npm run audit
```

## Vercel deployment

Deploy the existing `arc-trade-escrow` project with `frontend/` as its root.
Set these Vercel
environment variables for Preview and Production:

```dotenv
VITE_FACTORY_ADDRESS=0x83720927588845e7e5c6d12d73eccb39ace7c9bb
VITE_FACTORY_DEPLOYMENT_BLOCK=56261623
VITE_ARC_RPC_URL=https://rpc.testnet.arc.network
VITE_RELAYER_BASE_URL=<public relayer HTTPS URL>
VITE_CLIENT_KEY=<Circle Modular Wallet Web Client Key>
VITE_CLIENT_URL=https://modular-sdk.circle.com/v1/rpc/w3s/buidl
```

Add the Vercel hostname to the Circle Client Key Allowed Domain and configure
the same hostname as the Passkey Domain. The relayer must be publicly reachable
over HTTPS; `http://localhost:3001` is only for local development.

## Railway relayer deployment

The repository supports both Railway source-root layouts:

- With the repository root as the service root, Railway uses `/railway.json`
  and `relayer/Render.Dockerfile`.
- With `./relayer` as the service root, Railway uses `relayer/railway.json`
  and the self-contained `relayer/Dockerfile`.

For the second layout, no parent-directory Dockerfile paths are needed. Add
these service variables, keeping the signing key secret:

```dotenv
ARC_RPC_URL=https://rpc.testnet.arc.network
GATEWAY_API_BASE_URL=https://gateway-api-testnet.circle.com
RELAYER_PRIVATE_KEY=<relayer signing key>
SQLITE_PATH=/data/relayer.db
```

Railway supplies `PORT`; the relayer uses it automatically. Generate the
Railway HTTPS domain, verify `/status`, then set that URL as Vercel's
`VITE_RELAYER_BASE_URL`. The Railway URL is an API endpoint; it is not the
Circle Allowed Domain or Passkey Domain. Those remain the Vercel frontend
hostname.

## Verification

```sh
# From the repository root
npm run build
npm test

# From frontend/
npm run build
npm run audit
```

The relayer exposes `GET /status`, `GET /transfers`, and
`GET /settlements/:settlementKey`. Settlement labels are derived from relayer
state: payment processing, payment confirmed, or payment failed — contact
support.

## Circle product feedback

Modular Wallet passkeys and gas-sponsored smart-account operations make the
participant experience appropriate for trade workflows where users should not
manage private keys or native gas. The main integration improvement would be
clearer first-run diagnostics for Client Key type, entity provisioning, allowed
domains, Passkey Domains, and the selected chain; the raw SDK error for a
missing entity configuration is otherwise difficult to act on.
