# Frontend development notes

The frontend is a React/Vite/TypeScript app for the deployed Arc Trade Escrow
agreement. Project overview, deployment configuration, and submission
information live in the [root README](../README.md) and the root `submission/`
package.

## Local setup

Start the relayer from the repository root first:

```sh
./regenerate-config.sh
npm run build
npm start
```

Then configure `frontend/.env.local` from `.env.example` and set a valid Circle
Modular Wallet Web Client Key. The key must remain local and must have the
matching Circle entity, Allowed Domain, and Passkey Domain configuration.

```sh
npm install
npm run build
npm run audit
npm run dev
```

The Vite app runs on `http://localhost:5173` and expects the relayer at
`http://localhost:3001`. Vite reads environment variables at startup, so
restart the dev server after changing `.env.local`.
