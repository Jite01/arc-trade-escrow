export type AgreementStatus = "drafting" | "negotiating" | "agreed" | "deploying" | "deployed" | "cancelled";
export type ProposalStatus = "draft" | "pending" | "superseded" | "accepted" | "rejected" | "expired";

export type MilestoneInput = {
  description: string;
  basisPoints: number;
  sellerDeadlineSec: number;
  buyerResponseWindowSec: number;
  disputeWindowSec: number;
  proofDescription: string;
};

export type AgreementInput = {
  buyerAddress: string;
  sellerAddress: string;
  arbitrationAddress: string;
  operatorAddress: string;
  totalUSDC: string;
  negotiationExpiry: string;
  commitmentWindowSec: number;
  arbitrationTimeoutSec: number;
  goodsDescription: string;
  goodsCategory?: string | null;
  quantity?: string | number | null;
  quantityUnit?: string | null;
  qualityStandard?: string | null;
  transportMode: string;
  originCountry: string;
  originPortCity: string;
  destinationCountry: string;
  destinationPortCity: string;
  incoterm?: string | null;
  deliveryNamedPlace?: string | null;
  freightArranger: string;
  insuranceArranger: string;
  deliveryDeadline: string;
};

export type ProposalInput = { milestones: MilestoneInput[]; note?: string | null };
