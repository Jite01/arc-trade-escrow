import { config } from "./config";

export type Company = { slug: string; name: string; walletAddress: string; createdAt: number; updatedAt: number };
export type ProposalVisibility = "PUBLIC" | "PRIVATE";
export type Proposal = {
  id: string; proposerCompany: string; proposerAddress: string; recipientCompany: string | null;
  visibility: ProposalVisibility; status: "OPEN" | "ACCEPTED" | "EXPIRED" | "CANCELLED";
  title: string; description: string; totalUSDC: string; sellerCommitmentWindow: number;
  buyerResponseWindow: number; disputeWindow: number; proposalExpiresAt: number;
  milestones: Array<{ description: string; basisPoints: number; sellerDeadline: number; buyerResponseWindow: number; disputeWindow: number }>;
  agreementId: string | null; escrowAddress: string | null; acceptedByCompany: string | null; acceptedByAddress: string | null; createdAt: number; updatedAt: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.relayerUrl}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error || "Registry service unavailable"));
  return body as T;
}

export function normalizeCompanyName(name: string): string { return name.trim().replace(/\s+/g, " "); }
export async function lookupCompany(name: string): Promise<Company | null> { const response = await fetch(`${config.relayerUrl}/companies/lookup?name=${encodeURIComponent(normalizeCompanyName(name))}`); if (response.status === 404) return null; if (!response.ok) throw new Error("Company registry unavailable"); return response.json() as Promise<Company>; }
export async function companyByWallet(walletAddress: string): Promise<Company | null> { const response = await fetch(`${config.relayerUrl}/companies/by-wallet?address=${encodeURIComponent(walletAddress)}`); if (response.status === 404) return null; if (!response.ok) throw new Error("Company registry unavailable"); return response.json() as Promise<Company>; }
export function registerCompany(name: string, walletAddress: string): Promise<Company> { return request<Company>("/companies", { method: "POST", body: JSON.stringify({ name: normalizeCompanyName(name), walletAddress }) }); }
export function publicProposals(): Promise<Proposal[]> { return request<Proposal[]>("/proposals/public"); }
export function companyProposals(slug: string): Promise<Proposal[]> { return request<Proposal[]>(`/proposals/company/${encodeURIComponent(slug)}`); }
export function createProposal(input: Omit<Proposal, "id" | "createdAt" | "updatedAt" | "status" | "agreementId" | "escrowAddress" | "acceptedByCompany" | "acceptedByAddress">): Promise<Proposal> { return request<Proposal>("/proposals", { method: "POST", body: JSON.stringify(input) }); }
export function bindProposal(id: string, agreementId: string, escrowAddress: string): Promise<Proposal> { return request<Proposal>(`/proposals/${encodeURIComponent(id)}/bind`, { method: "POST", body: JSON.stringify({ agreementId, escrowAddress }) }); }
export function acceptProposal(id: string, company: string, walletAddress: string): Promise<Proposal> { return request<Proposal>(`/proposals/${encodeURIComponent(id)}/accept`, { method: "POST", body: JSON.stringify({ company, walletAddress }) }); }
export function getProposal(id: string): Promise<Proposal> { return request<Proposal>(`/proposals/${encodeURIComponent(id)}`); }
