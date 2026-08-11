# Arc Trade — Senior Agent Handoff

## Goal

Take Arc Trade from a hackathon-working demo to a professionally launchable
documentary trade escrow product for Arc Mainnet. The immediate product is a
reliable agreement registry: companies create, receive, review, accept, fund,
execute, dispute, and settle time-bound documentary agreements. A marketplace
is explicitly deferred. Discovery, listings, bidding, and search may be built
only after the agreement-registry product is genuinely complete and reliable.

The next agent must review the whole repository, not merely implement the last
requested UI change. Understand the existing contract, frontend, Railway
relayer, proposal registry, Circle integration, deployment artifacts, tests,
README, and submission before making architectural decisions. Identify and
repair inconsistencies proactively. Preserve the proven escrow/Gateway core
unless a concrete security or mainnet-readiness issue requires change.

## Required agent persona

Act as a senior React/Vite/TypeScript frontend engineer and product designer
with strong architectural judgment, accessibility instincts, responsive UI
experience, and excellent branding sense. Make considered decisions without
waiting for every visual detail to be dictated. Review the work critically,
finish incomplete flows, remove dead ends, and make the result feel like a
credible product rather than a generated hackathon interface.

## Product and language direction

Arc Trade is an agreement registry, not a marketplace. The architectural truth
is:

```text
Circle company identity
        ↓
Railway proposal/company registry
        ↓
Agreement Factory
        ↓
One escrow clone per accepted agreement
        ↓
Circle Gateway settlement
```

Use professional documentary-commerce language throughout the product. Avoid
making “buyer” and “seller” the dominant product identity; those are temporary
agreement roles. Prefer initiating company, recipient, counterparty, issuer,
and participant where the meaning remains clear. In particular:

- “Seller commitment” means the recipient response window.
- “Buyer response” means the negotiation window.
- “Proposal stays open” means proposal lifetime.
- An accepted proposal becomes a live agreement once the factory deployment is
  bound to it.
- Never expose implementation jargon such as “factory”, “ERC-1271”, “Gateway
  burn intent”, or “relayer” in ordinary user-facing copy unless a technical
  document explicitly calls for it.

## Branding and visual direction

The design theme must be inspired by the phrase “documentary trade escrow”:
paper records, documentary evidence, commercial correspondence, a serious
trade desk, accountable commitments, and controlled settlement. The visual
system should feel editorial, precise, calm, and operational—not like a crypto
casino, generic SaaS dashboard, or marketplace.

The current direction uses ink navy, warm paper, signal orange, restrained
green, mono metadata, and editorial typography. Keep evolving that system with
discipline:

- warm paper/ink contrast for documents and agreement letters;
- orange only for action, attention, and active registry signals;
- muted green for verified/live/settled states;
- mono type for references, timestamps, and technical identifiers;
- generous editorial spacing and strong hierarchy;
- restrained motion that clarifies state: document reveal, copied feedback,
  flowing registry dots, menu-to-X transition, and live status pulses;
- responsive layouts designed from the smallest phone upward;
- accessible focus states, readable contrast, semantic controls, and no motion
  that blocks use.

Review every word from hero to “How it works”. The brand promise should be
consistent: Arc Trade makes documentary commitments legible, time-bound, and
accountable before value moves.

## Contract architecture

The deployed Agreement Factory is:

```text
0x83720927588845e7e5c6d12d73eccb39ace7c9bb
```

Arc Testnet chain ID is `5042002`; factory deployment block is `56261623`.

The factory is already multi-agreement. It is not limited to one pair and is
not a factory of factories. It clones one `DocumentaryTradeEscrow` instance
per agreement:

```text
Factory → Agreement A → Escrow A → participants A
        → Agreement B → Escrow B → participants B
        → Agreement C → Escrow C → participants C
```

The caller of `createAgreement` becomes the initiating participant; the
provided address becomes the counterparty. The factory indexes both addresses.
The arbitrator and operator are currently platform-level immutable factory
settings and are passed into each clone.

The escrow contract is the source of truth for terms, milestones, approvals,
funding, deadlines, disputes, arbitration, release, reclaim, and settlement
records. Railway is the application registry for companies and proposals; it
does not replace on-chain agreement truth.

## ERC-1271 / EIP-712 settlement truth

The contract uses ERC-1271 contract-signature validation and EIP-712 structured
hashing for Circle Gateway BurnIntents. The escrow does not own a private key.
The operator may authorize a hash derived from an already-recorded settlement;
the escrow then returns `0x1626ba7e` from `isValidSignature` for that exact hash.
The signature bytes are intentionally ignored because authorization is stored
on-chain. Gateway checks the escrow contract as the source signer/depositor.

Milestone release itself is contract-enforced and can be triggered by a public
caller after the relevant windows. The full settlement path is not entirely
permissionless: the configured operator still authorizes the Gateway intent,
while the contract fixes the recipient and amount from the recorded settlement.
Describe this accurately as trust-minimized, contract-enforced, and
operator-assisted Gateway settlement—not fully trustless settlement.

## Current deployment

- Frontend: `https://arc-trade-escrow.vercel.app`
- Relayer/registry: `https://arc-trade-escrow-relayer-production-56a0.up.railway.app`
- Railway is now the permanent hosted relayer/registry environment.
- SQLite must use the mounted Railway volume, normally `/data/relayer.db`.
- The relayer discovers factory-created escrow clones and polls their events.
- The Vercel hostname—not Railway—is the Circle Allowed Domain and Passkey
  Domain.

## Important current state and known issues

1. New-account creation previously failed for short names such as `Bose`.
Circle requires a 5–50 character restricted passkey username. The latest
`frontend/src/wallet.ts` normalizes display names into a stable Circle-safe
identifier while preserving the company’s real display name in the registry.
This fix must be present in the deployed Vercel bundle before retesting.

2. Arc-Fin previously reached a valid passkey session without a matching
company row. The dashboard now offers recovery and pre-fills the known company
name. Verify the complete recovery path against the persistent Railway database;
do not accept a UI-only recovery gimmick as complete.

3. Activity is split into Issued and Received proposals. An accepted proposal
is shown as a live agreement only after it has an agreement ID and escrow
address; before the issuer deploys it, the UI says it is accepted and awaiting
the issuer. Keep this distinction truthful.

4. The compact workspace menu must transform its two horizontal bars into a
real diagonal X. It must work on touch devices, keyboard focus, and repeated
open/close cycles.

5. Public proposals are global through Railway’s proposal API and SQLite. They
are durable only if the Railway volume is actually mounted and the running
service is using `/data/relayer.db`. Validate this operationally.

## Legacy configuration that must not be mistaken for the product model

The repository still contains historical singleton/demo material:

- root `.env.example` contains `BUYER_ADDRESS`, `SELLER_ADDRESS`, and related
  direct-deployment variables;
- `scripts/activate-escrow.ts` exercises the old single escrow with private
  buyer/seller keys;
- generated `config.json` still contains the original singleton
  `CONTRACT_ADDRESS` (`0xc36a8ca590405fa7c9df44c46ff784a33530a4b0`);
- the Solidity escrow contains Arc Testnet-specific USDC, Gateway Wallet,
  Gateway Minter, and domain constants;
- the factory’s arbitrator/operator are platform-wide, not per-company.

These are either legacy tooling, generated compatibility data, or deliberate
testnet constraints. Review them for cleanup and mainnet deployment planning.
Do not reintroduce fixed participant addresses into the frontend or registry.
Mainnet will require a new deployment with the correct Circle addresses/domain,
regenerated artifacts, and a coordinated frontend/relayer release.

## Files to understand first

- `README.md` — declared architecture, deployment, and verification contract.
- `src/DocumentaryTradeEscrow.sol` — escrow lifecycle and ERC-1271/EIP-712.
- `src/DocumentaryTradeEscrowFactory.sol` — clone factory and participant index.
- `frontend/src/main.tsx` — product flow and workspace UI.
- `frontend/src/wallet.ts` — Circle passkey and smart-account integration.
- `frontend/src/contract.ts` — factory/escrow reads and writes.
- `frontend/src/registry.ts` — Railway company/proposal API.
- `relayer/src/status-server.ts` and `relayer/src/database.ts` — hosted registry.
- `relayer/src/event-source.ts` and `relayer/src/relayer.ts` — dynamic escrow
  discovery and Gateway settlement processing.
- `relayer/src/config.ts` and `config.json` — deployment/runtime boundary.
- `test/` and `relayer/test/` — lifecycle and settlement evidence.
- `submission/arc-trade-escrow-submission.pdf` — do not modify or commit.

## Handoff discipline

Before changing architecture, run a repository-wide review and write down what
is already true, what is legacy, and what is actually broken. Preserve user
changes and unrelated work. Verify frontend TypeScript/audit, relayer build,
tests, and diff whitespace checks. Never commit `submission/`.

The next milestone is not “add marketplace features”. It is a dependable,
beautiful agreement-registry product with a working new-company flow, durable
global proposal registry, truthful agreement lifecycle, complete hosted E2E,
and a clear path from Arc Testnet to Arc Mainnet.
