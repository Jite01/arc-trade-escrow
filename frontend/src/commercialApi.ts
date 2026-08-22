import type { EmbeddedWalletSession } from "./wallet";

export type CommercialMilestone = { id?: string; index?: number; description: string; basisPoints: number; sellerDeadlineSec: number; buyerResponseWindowSec: number; disputeWindowSec: number; proofDescription: string };
export type CommercialProfile = { id: string; walletAddress: string; companyName: string; country: string; tradeCategory: string | null; verifiedTradeCount: number; createdAt: string };
export type PublicInvitation = { token: string; agreementId: string; referenceCode: string; goodsDescription: string; originCountry: string; destinationCountry: string; totalUSDC: string; buyerCompanyName: string; role: "buyer" | "seller"; expiresAt: string; acceptedAt: string | null; revokedAt: string | null };
export type CommercialAgreement = {
  id: string; referenceCode: string; contractAddress: string | null; deploymentBlock: number | null; onchainState: string | null; finalized_hash: string | null; buyerAddress: string | null; sellerAddress: string | null; arbitrationAddress: string; resolutionPolicy: "ARCTRADE_DEFAULT" | "MUTUAL_RESOLVER"; assignedResolverAddress: string | null; operatorAddress: string; totalUSDC: string; negotiationExpiry: string; commitmentWindowSec: number; arbitrationTimeoutSec: number; status: string; goodsDescription: string; goodsCategory: string | null; quantity: string | null; quantityUnit: string | null; qualityStandard: string | null; transportMode: string; originCountry: string; originPortCity: string; destinationCountry: string; destinationPortCity: string; incoterm: string | null; deliveryNamedPlace: string | null; deliveryNamedPlaceType: string | null; freightArranger: string; insuranceArranger: string; deliveryDeadline: string; latestProposal: CommercialProposal | null; agreedMilestones: CommercialMilestone[] | null;
};
export type CommercialProposal = { id: string; agreementId: string; proposedBy: string; parentProposalId: string | null; proposalHash: string | null; arrayVersion: number; status: string; note: string | null; createdAt: string; milestones: CommercialMilestone[] };
export type CommercialDiff = { proposalId: string; previousProposalId: string | null; changedMilestones: Array<{ index: number; description: string; changes: Array<{ field: string; was: unknown; now: unknown }>; warnings: string[] }>; warnings: string[]; note: string | null };

const configuredBaseUrl = (import.meta.env.VITE_AGREEMENT_API_URL || "").trim();
const baseUrl = (configuredBaseUrl || (import.meta.env.DEV ? "http://localhost:4000" : "")).replace(/\/$/, "");
const authStorageKey = (address: string) => `arc-trade-commercial-auth:${address.toLowerCase()}`;

async function accessToken(session: EmbeddedWalletSession): Promise<string> {
  const stored = sessionStorage.getItem(authStorageKey(session.address));
  if (stored) {
    try { const encoded = stored.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"); const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="); if (JSON.parse(atob(padded)).exp * 1000 > Date.now() + 30_000) return stored; } catch { sessionStorage.removeItem(authStorageKey(session.address)); }
  }
  const verifyResponse = await fetch(`${baseUrl}/auth/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: session.address, accountFactory: session.accountFactory, accountFactoryData: session.accountFactoryData }) });
  const verified = await verifyResponse.json().catch(() => ({}));
  if (!verifyResponse.ok) throw new Error(String(verified.error || "Could not verify wallet sign-in"));
  sessionStorage.setItem(authStorageKey(session.address), verified.accessToken);
  return verified.accessToken as string;
}

async function request<T>(path: string, session: EmbeddedWalletSession, init?: RequestInit): Promise<T> {
  if (!baseUrl) throw new Error("Commercial agreement service is not configured for this deployment");
  const token = await accessToken(session);
  const response = await fetch(`${baseUrl}${path}`, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error || body.message || "Agreement service unavailable"));
  return body as T;
}

export const createCommercialAgreement = (session: EmbeddedWalletSession, body: Record<string, unknown>) => request<{ agreementId: string; referenceCode: string; agreement: CommercialAgreement }>("/agreements", { ...session }, { method: "POST", body: JSON.stringify({ ...body, createdBy: session.address }) });
export const getCommercialAgreement = (session: EmbeddedWalletSession, id: string) => request<CommercialAgreement>(`/agreements/${encodeURIComponent(id)}`, session);
export const getMyProfile = async (session: EmbeddedWalletSession) => { try { return await request<CommercialProfile>("/profiles/me", session); } catch (error) { if (error instanceof Error && /profile not found/i.test(error.message)) return null; throw error; } };
export const saveMyProfile = (session: EmbeddedWalletSession, input: { companyName: string; country: string; tradeCategory?: string | null }) => request<CommercialProfile>("/profiles/me", session, { method: "POST", body: JSON.stringify(input) });
export const searchCommercialProfiles = (session: EmbeddedWalletSession, query: string) => request<CommercialProfile[]>(`/profiles/search?q=${encodeURIComponent(query)}`, session);
export const lookupCommercialProfile = async (session: EmbeddedWalletSession, walletAddress: string) => { try { return await request<CommercialProfile>(`/profiles/${encodeURIComponent(walletAddress)}`, session); } catch (error) { if (error instanceof Error && /profile not found/i.test(error.message)) return null; throw error; } };
export const createCommercialInvitation = (session: EmbeddedWalletSession, id: string) => request<{ inviteUrl: string; token: string; expiresAt: string; role: "buyer" | "seller" }>(`/agreements/${encodeURIComponent(id)}/invite`, session, { method: "POST", body: "{}" });
export const getPublicInvitation = async (token: string) => { if (!baseUrl) throw new Error("Commercial agreement service is not configured for this deployment"); const response = await fetch(`${baseUrl}/invite/${encodeURIComponent(token)}`, { cache: "no-store" }); const body = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(String(body.error || "Invitation unavailable")); (error as Error & { status?: number }).status = response.status; throw error; } return body as PublicInvitation; };
export const acceptCommercialInvitation = (session: EmbeddedWalletSession, token: string, profile?: { companyName: string; country: string; tradeCategory?: string | null }) => request<{ agreementId: string; agreement: CommercialAgreement }>(`/invite/${encodeURIComponent(token)}/accept`, session, { method: "POST", body: JSON.stringify(profile || {}) });
export const listCommercialProposals = (session: EmbeddedWalletSession, id: string) => request<CommercialProposal[]>(`/agreements/${encodeURIComponent(id)}/proposals`, session);
export const sendCommercialProposal = (session: EmbeddedWalletSession, id: string, milestones: CommercialMilestone[], note?: string) => request<CommercialProposal>(`/agreements/${encodeURIComponent(id)}/proposals`, session, { method: "POST", body: JSON.stringify({ milestones, note: note || null }) });
export const acceptCommercialProposal = (session: EmbeddedWalletSession, id: string, proposalId: string) => request<{ proposal: CommercialProposal; agreed: boolean; agreedMilestones: CommercialMilestone[] | null }>(`/agreements/${encodeURIComponent(id)}/accept`, session, { method: "POST", body: JSON.stringify({ proposal_id: proposalId }) });
export const getCommercialDiff = (session: EmbeddedWalletSession, id: string, proposalId: string) => request<CommercialDiff>(`/agreements/${encodeURIComponent(id)}/diff/${encodeURIComponent(proposalId)}`, session);
export const createCommercialDeployIntent = (session: EmbeddedWalletSession, id: string) => request<{ buyerAddress: string; sellerAddress: string; arbitrationAddress: string; operatorAddress: string; totalUSDC: string; negotiationExpiry: number; commitmentWindow: number; arbitrationTimeout: number }>(`/agreements/${encodeURIComponent(id)}/deploy-intent`, session, { method: "POST", body: "{}" });
export const confirmCommercialDeployment = (session: EmbeddedWalletSession, id: string, txHash: string) => request<CommercialAgreement>(`/agreements/${encodeURIComponent(id)}/deployment-confirmation`, session, { method: "POST", body: JSON.stringify({ txHash }) });
