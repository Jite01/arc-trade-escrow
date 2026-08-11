# Arc Trade Handoff

Current state:
- Hosted relayer is healthy at `https://arc-trade-escrow-relayer-production-56a0.up.railway.app/status`.
- Frontend is deployed from `main`, but the remaining work is UX and wording alignment, not contract or relayer rewrites.
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
- Public proposals are public listings. They should use an ID and appear in the public proposals list.
- Public proposals should not generate recipient-specific invite links.
- Private proposals should generate a copyable invite link that includes the recipient company/profile in the route.
- When a private invite link is opened, prefill the recipient company from the URL and route the visitor into auth.

What the next agent should do:
1. Rename the remaining frontend copy and labels to neutral proposal language.
2. Fix the login/register branching so `Login` authenticates existing profiles instead of telling users to switch actions.
3. Make the missing-profile path show `Proceed`, not `Proceed with passkey`.
4. Make private invite links prefill the recipient company and keep public proposals ID-only.
5. Leave the factory/registry/escrow architecture intact.

Most relevant file:
- `frontend/src/main.tsx`
