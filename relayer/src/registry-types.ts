export type ProposalVisibility = "PUBLIC" | "PRIVATE";
export type ProposalStatus = "OPEN" | "ACCEPTED" | "EXPIRED" | "CANCELLED";

export interface CompanyRecord {
  slug: string;
  name: string;
  walletAddress: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProposalRecord {
  id: string;
  proposerCompany: string;
  proposerAddress: string;
  recipientCompany: string | null;
  visibility: ProposalVisibility;
  status: ProposalStatus;
  title: string;
  description: string;
  totalUSDC: string;
  sellerCommitmentWindow: number;
  buyerResponseWindow: number;
  disputeWindow: number;
  proposalExpiresAt: number;
  milestones: Array<{ description: string; basisPoints: number; sellerDeadline: number; buyerResponseWindow: number; disputeWindow: number }>;
  agreementId: string | null;
  escrowAddress: string | null;
  acceptedByCompany: string | null;
  acceptedByAddress: string | null;
  createdAt: number;
  updatedAt: number;
}

export function companySlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

export function publicProposal(record: ProposalRecord, now = Math.floor(Date.now() / 1000)): boolean {
  return record.visibility === "PUBLIC" && record.status === "OPEN" && record.proposalExpiresAt > now;
}
