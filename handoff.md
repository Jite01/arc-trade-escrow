# Arc Trade Handoff

Current state:
- Hosted relayer endpoint: `https://arc-trade-escrow-relayer-production-56a0.up.railway.app/status`. Recheck `ready: true` after each Railway deployment.
- Frontend is deployed from `main`; the current local changes add a branded trade-desk UI, readable server-owned proposal references, a prominent profile balance, and responsive progressive-disclosure forms.
- Keep `submission/` untouched.

Product direction:
- This should read as a professional proposal/registry app, not a buyer/seller demo.
- Remove buyer/seller language from the UI where possible.
- `seller commitment` should be renamed in the UI to `proposal response window` or `recipient response window`.
- `buyer response` is really the negotiation window.
- `proposal stays open` is the proposal lifetime.

Auth rules:
- Landing has two actions: `Send an Agreement` and `Login`.
- `Login` is only an access action. It should sign in an existing company profile.
- If the company profile is missing, show: profile not found, then `Proceed` to create it.
- Do not send unknown visitors to a dead-end “use Send an Agreement” message.
- `Send an Agreement` should work for both new and existing profiles.
- The recipient role is temporary and proposal-scoped, not a permanent identity.

Proposal rules:
- Public proposals are global listings. Every signed-in company loads the same `GET /proposals/public` board.
- Proposal IDs are registry references, not transaction IDs: new records are created server-side as `AT-<time>-<random>`. The on-chain agreement ID/address is created only after acceptance and deployment.
- Public proposals should not generate recipient-specific invite links.
- Private proposals should generate a copyable invite link that includes the recipient company/profile in the route.
- When a private invite link is opened, prefill the recipient company from the URL and route the visitor into auth.
- Vercel must rewrite deep `/signin/...` paths to `/index.html`; this is now declared in `frontend/vercel.json`.
- The generated share result belongs inline beneath the proposal form after publish; do not restore a persistent top-of-dashboard invitation banner.
- Expired proposals can be removed by their proposer through the authenticated `DELETE /proposals/:id` route.

Critical persistence note:
- The registry is currently SQLite (`SQLITE_PATH`). It is global only while the deployed database survives restarts. Railway must use a persistent volume or the registry must move to a hosted database before claiming durable multi-user state.
- Railway’s documented fix is a Volume attached to the relayer at `/data`, with `SQLITE_PATH=/data/relayer.db`; this is a dashboard action, not something the repository config can safely create.

What the next agent should do:
1. Deploy the current frontend and relayer changes together; proposal IDs, deletion, CORS, and private-link routing are now part of the contract between them.
2. Attach Railway persistent storage at `/data` and set `SQLITE_PATH=/data/relayer.db`. This is the remaining infrastructure requirement for durable global state.
3. Keep private-link auth explicit: a URL can identify and prefill the recipient company, but cannot silently authenticate as that company; the recipient must complete a passkey gesture.
4. Leave the factory/registry/escrow architecture intact.

Most relevant file:
- `frontend/src/main.tsx`
