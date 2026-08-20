# ArcTrade Resolution Router

`ResolutionRouter` is the arbitration authority supplied to new
`DocumentaryTradeEscrow` deployments. It does not hold funds, select
resolvers, or call Gateway.

## Authorization model

The router verifies one EIP-712 `ResolutionAssignment` signed by the buyer,
seller, and resolver, followed by one EIP-712 `ResolutionDecision` signed by
the resolver. EOA signatures use strict low-s ECDSA recovery. Contract wallets
are checked through ERC-1271.

The EIP-712 domain is:

```text
name:              ArcTrade Resolution Router
version:           1
chainId:           current chain ID
verifyingContract: router address
```

`ResolutionAssignment` contains:

```text
caseId, escrow, milestoneIndex, buyer, seller, resolver,
assignmentNonce, assignmentExpiry
```

`ResolutionDecision` contains:

```text
caseId, escrow, milestoneIndex, resolver, recipient,
decisionNonce, decisionExpiry, assignmentNonce, assignmentExpiry
```

The router derives:

```text
caseId = keccak256(abi.encode(chainId, router, escrow, milestoneIndex))
```

This is unique for the current escrow because a milestone can enter
`DISPUTED` only once. A future escrow that permits repeated disputes must use
a new router/case schema with an explicit dispute nonce.

At execution, the router verifies the live escrow address, buyer, seller,
arbitration address, dispute state, recipient, signature expiries, and
one-time case consumption before calling `escrow.arbitrate()`.

## Gateway boundary

The router ends at the escrow settlement record:

```text
resolver decision
  -> ResolutionRouter
  -> DocumentaryTradeEscrow.arbitrate()
  -> recorded recipient and amount
  -> operator authorizeBurnIntent()
  -> Gateway/ERC-1271 settlement
```

The relayer treats `(escrow, settlementIndex)` as the logical settlement
identity, derives a deterministic burn-intent salt, persists the exact intent,
and reuses it during recovery. It verifies the live escrow settlement and the
`BurnIntentAuthorized` event before submitting to Gateway.

## Testing

Foundry tests cover EOA and ERC-1271 participants, exact case IDs, concurrent
disputes, force-release races, replay, wrong-router binding, and exact
settlement recording.

`scripts/gateway-compatibility.ts` is an explicitly opt-in Arc Testnet harness
for two different salts against a recorded settlement. It refuses to run
without both:

```text
RUN_LIVE_GATEWAY_DUPLICATE_TEST=true
CONFIRM_DUPLICATE_TEST=I_UNDERSTAND_DUPLICATE_TESTNET_PAYOUT_RISK
```

Do not describe the contract-signer/ERC-1271 Gateway path as verified until
that harness has been run against a funded, disposable Arc Testnet escrow and
the resulting API responses and transfer status have been recorded.
