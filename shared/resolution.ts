import { AbiCoder, TypedDataEncoder, keccak256 } from "ethers";

export const RESOLUTION_ROUTER_DOMAIN = (chainId: bigint | number, router: string) => ({
  name: "ArcTrade Resolution Router",
  version: "1",
  chainId,
  verifyingContract: router
});

export const RESOLUTION_ROUTER_TYPES = {
  ResolutionAssignment: [
    { name: "caseId", type: "bytes32" },
    { name: "escrow", type: "address" },
    { name: "milestoneIndex", type: "uint256" },
    { name: "buyer", type: "address" },
    { name: "seller", type: "address" },
    { name: "resolver", type: "address" },
    { name: "assignmentNonce", type: "uint256" },
    { name: "assignmentExpiry", type: "uint256" }
  ],
  ResolutionDecision: [
    { name: "caseId", type: "bytes32" },
    { name: "escrow", type: "address" },
    { name: "milestoneIndex", type: "uint256" },
    { name: "resolver", type: "address" },
    { name: "recipient", type: "address" },
    { name: "decisionNonce", type: "uint256" },
    { name: "decisionExpiry", type: "uint256" },
    { name: "assignmentNonce", type: "uint256" },
    { name: "assignmentExpiry", type: "uint256" }
  ]
} as const;

export function resolutionCaseId(chainId: bigint | number, router: string, escrow: string, milestoneIndex: bigint | number): string {
  return keccak256(AbiCoder.defaultAbiCoder().encode(["uint256", "address", "address", "uint256"], [chainId, router, escrow, milestoneIndex]));
}

export function resolutionAssignmentDigest(chainId: bigint | number, router: string, assignment: Record<string, unknown>): string {
  return TypedDataEncoder.hash(RESOLUTION_ROUTER_DOMAIN(chainId, router), RESOLUTION_ROUTER_TYPES, assignment);
}

export function resolutionDecisionDigest(chainId: bigint | number, router: string, decision: Record<string, unknown>): string {
  return TypedDataEncoder.hash(RESOLUTION_ROUTER_DOMAIN(chainId, router), RESOLUTION_ROUTER_TYPES, decision);
}
