# Arc Trade Escrow

Arc Trade Escrow is a documentary trade agreement on Arc Testnet. Buyer and
seller actions are authorized by `DocumentaryTradeEscrow`; Circle Modular
Wallet passkeys provide user-controlled smart accounts; and a TypeScript
relayer executes contract-authorized Circle Gateway settlements.

The frontend never calls Gateway and never handles private settlement data.
The contract is the source of truth for agreement state and authorization.

## Active demo

- Network: Arc Testnet (`5042002`)
- Contract: `0xdfe3495a871e17317b50c5b1b688554ee7194037`
- Deployment block: `56139585`
- Local frontend: `http://localhost:5173`
- Local relayer API: `http://localhost:3001`

The deployed agreement is configured for three Circle Modular Wallet accounts.
Sign in with the buyer, seller, or arbitrator passkey to see role-specific
controls. The complete flow covers proposal and approval, securing funds,
milestone progression, release or arbitration, and relayer settlement status.

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
VITE_CONTRACT_ADDRESS=0xdfe3495a871e17317b50c5b1b688554EE7194037
VITE_CONTRACT_ABI=
VITE_DEPLOYMENT_BLOCK=56139585
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

Deploy the `frontend/` directory as the Vercel project root. Set these Vercel
environment variables for Preview and Production:

```dotenv
VITE_CONTRACT_ADDRESS=0xdfe3495a871e17317b50c5b1b688554EE7194037
VITE_CONTRACT_ABI=
VITE_DEPLOYMENT_BLOCK=56139585
VITE_ARC_RPC_URL=https://rpc.testnet.arc.network
VITE_RELAYER_BASE_URL=<public relayer HTTPS URL>
VITE_CLIENT_KEY=<Circle Modular Wallet Web Client Key>
VITE_CLIENT_URL=https://modular-sdk.circle.com/v1/rpc/w3s/buidl
```

Add the Vercel hostname to the Circle Client Key Allowed Domain and configure
the same hostname as the Passkey Domain. The relayer must be publicly reachable
over HTTPS; `http://localhost:3001` is only for local development.

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
