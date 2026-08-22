import express, { type NextFunction, type Request, type Response } from "express";
import { Pool } from "pg";
import { createWalletAuth, type WalletRequest } from "./auth.js";
import { createRepository } from "./repository.js";
import { validateAgreementInput, validateProfileInput, validateProposalMilestones, isAddress } from "./validation.js";
import { createDeploymentVerifier, validateDeploymentConfiguration } from "./deploymentVerifier.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DATABASE_POOL_MAX || 10), ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });
const repository = createRepository(pool);
const verifyDeployment = createDeploymentVerifier();
const platformOperator = (process.env.PLATFORM_OPERATOR_ADDRESS || process.env.OPERATOR_ADDRESS || "0x0bF9683D68c79976281A6a16CFb9A49608a1a37c").toLowerCase();
const resolutionRouter = (process.env.RESOLUTION_ROUTER_ADDRESS || process.env.ROUTER_ADDRESS || "").toLowerCase();
const walletAuth = createWalletAuth(pool);
const app = express();
app.use(express.json({ limit: "128kb" }));
const allowedOrigins = new Set((process.env.FRONTEND_ORIGIN || "").split(",").map(value => value.trim()).filter(Boolean));
app.use((request, response, next) => {
  const origin = request.header("origin");
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  }
  if (request.method === "OPTIONS") return response.sendStatus(204);
  next();
});
app.get("/healthz", async (_request, response) => {
  try { await pool.query("SELECT 1"); return response.json({ ok: true }); }
  catch { return response.status(503).json({ ok: false }); }
});
app.post("/auth/challenge", async (request, response, next) => {
  try {
    const address = String(request.body?.address || "");
    if (!isAddress(address)) return response.status(422).json({ error: "A valid wallet address is required" });
    return response.json(await walletAuth.challenge(address, String(request.header("origin") || process.env.FRONTEND_ORIGIN || "unknown")));
  } catch (error) { return next(error); }
});
app.post("/auth/verify", async (request, response, next) => {
  try {
    return response.json(await walletAuth.verify(String(request.body?.challengeId || ""), String(request.body?.address || ""), String(request.body?.signature || "")));
  } catch (error) { return next(error); }
});
app.post("/auth/session", async (request, response, next) => {
  try { return response.json(await walletAuth.verifyCounterfactual(String(request.body?.address || ""), String(request.body?.accountFactory || ""), String(request.body?.accountFactoryData || ""))); } catch (error) { return next(error); }
});
app.get("/invite/:token", async (request, response, next) => {
  try {
    const token = String(request.params.token || "");
    if (!/^[0-9a-f]{64}$/i.test(token)) return response.status(404).json({ error: "Invitation not found" });
    const invitation = await repository.getInvitation(token);
    if (!invitation) return response.status(404).json({ error: "Invitation not found" });
    if (invitation.revokedAt) return response.status(410).json({ error: "This invitation has been replaced" });
    if (invitation.acceptedAt) return response.status(410).json({ error: "This invitation has already been accepted" });
    if (new Date(invitation.expiresAt).getTime() <= Date.now()) return response.status(410).json({ error: "This invitation has expired" });
    return response.json(invitation);
  } catch (error) { return next(error); }
});
app.use((request, response, next) => request.path.startsWith("/internal/") ? next() : walletAuth.middleware(request, response, next));

app.get("/profiles/me", async (request, response, next) => {
  try { const profile = await repository.getProfile((request as WalletRequest).walletAddress); return profile ? response.json(profile) : response.status(404).json({ error: "Profile not found" }); } catch (error) { return next(error); }
});
app.post("/profiles/me", async (request, response, next) => {
  try {
    const result = validateProfileInput(request.body || {});
    if (!result.ok) return response.status(422).json(result);
    return response.status(201).json(await repository.saveProfile((request as WalletRequest).walletAddress, request.body));
  } catch (error) { return next(error); }
});
app.get("/profiles/search", async (request, response, next) => {
  try {
    const query = String(request.query.q || "").trim();
    if (query.length < 2) return response.status(422).json({ error: "Search requires at least two characters" });
    return response.json(await repository.searchProfiles(query, (request as WalletRequest).walletAddress));
  } catch (error) { return next(error); }
});
app.get("/profiles/:walletAddress", async (request, response, next) => {
  try {
    const walletAddress = String(request.params.walletAddress || "");
    if (!isAddress(walletAddress)) return response.status(422).json({ error: "A valid wallet address is required" });
    const profile = await repository.getProfile(walletAddress);
    return profile ? response.json(profile) : response.status(404).json({ error: "Profile not found" });
  } catch (error) { return next(error); }
});

app.post("/agreements", async (request: Request, response, next) => {
  try {
    const walletRequest = request as WalletRequest;
    if (!await repository.getProfile(walletRequest.walletAddress)) return response.status(409).json({ error: "Complete your company profile before creating an agreement" });
    const input = request.body as Record<string, unknown>;
    const result = validateAgreementInput(input, new Date());
    if (!result.ok) return response.status(422).json(result);
    if (!isAddress(resolutionRouter)) return response.status(503).json({ error: "Resolution Router is not configured" });
    if (input.arbitrationAddress !== undefined && String(input.arbitrationAddress).toLowerCase() !== resolutionRouter) return response.status(422).json({ error: "arbitrationAddress must be the configured Resolution Router" });
    if (String(input.operatorAddress).toLowerCase() !== platformOperator) return response.status(422).json({ error: "operatorAddress must match the platform settlement operator" });
    if (String(input.createdBy || walletRequest.walletAddress).toLowerCase() !== walletRequest.walletAddress) return response.status(403).json({ error: "createdBy must match the authenticated wallet" });
    const buyer = String(input.buyerAddress || "").toLowerCase();
    const seller = String(input.sellerAddress || "").toLowerCase();
    if (walletRequest.walletAddress !== buyer && walletRequest.walletAddress !== seller) return response.status(403).json({ error: "The authenticated wallet must be one of the known parties" });
    const agreement = await repository.createAgreement({ ...input, arbitrationAddress: resolutionRouter, resolutionPolicy: String(input.resolutionPolicy || "ARCTRADE_DEFAULT") } as never, walletRequest.walletAddress);
    return response.status(201).json({ agreementId: agreement.id, referenceCode: agreement.referenceCode, agreement });
  } catch (error) { return next(error); }
});

app.get("/agreements", async (request: Request, response, next) => {
  try { return response.json(await repository.listAgreements((request as WalletRequest).walletAddress)); } catch (error) { return next(error); }
});
app.get("/agreements/:id", agreementGuard, async (request: Request, response, next) => {
  try { const agreement = await repository.getAgreement(String(request.params.id)); return agreement ? response.json(agreement) : response.status(404).json({ error: "Agreement not found" }); } catch (error) { return next(error); }
});
app.get("/agreements/:id/proposals", agreementGuard, async (request, response, next) => {
  try { return response.json(await repository.listProposals(String(request.params.id))); } catch (error) { return next(error); }
});
app.post("/agreements/:id/invite", agreementGuard, async (request: Request, response, next) => {
  try {
    const walletRequest = request as WalletRequest;
    const configuredOrigin = (process.env.PUBLIC_APP_URL || process.env.FRONTEND_ORIGIN || "").split(",")[0].trim().replace(/\/$/, "");
    if (!configuredOrigin) return response.status(503).json({ error: "Public application URL is not configured" });
    const invitation = await repository.createInvitation(String(request.params.id), walletRequest.walletAddress);
    return response.status(201).json({ ...invitation, inviteUrl: `${configuredOrigin}/invite/${invitation.token}` });
  } catch (error) { return next(error); }
});
app.post("/invite/:token/accept", async (request: Request, response, next) => {
  try {
    const token = String(request.params.token || "");
    if (!/^[0-9a-f]{64}$/i.test(token)) return response.status(404).json({ error: "Invitation not found" });
    const hasProfileInput = request.body && Object.keys(request.body).length > 0;
    const profileResult = hasProfileInput ? validateProfileInput(request.body) : { ok: true as const };
    if (!profileResult.ok) return response.status(422).json(profileResult);
    const agreement = await repository.acceptInvitation(token, (request as WalletRequest).walletAddress, hasProfileInput ? request.body : null);
    return response.json({ agreementId: agreement.id, agreement });
  } catch (error) { return next(error); }
});
app.post("/agreements/:id/proposals", agreementGuard, async (request: Request, response, next) => {
  try { const walletRequest = request as WalletRequest; const result = validateProposalMilestones(request.body?.milestones); if (!result.ok) return response.status(422).json(result); return response.status(201).json(await repository.createProposal(String(request.params.id), walletRequest.walletAddress, request.body)); } catch (error) { return next(error); }
});
app.patch("/agreements/:id", agreementGuard, async (request: Request, response, next) => {
  try {
    const walletRequest = request as WalletRequest;
    const current = await repository.getAgreement(String(request.params.id));
    if (!current) return response.status(404).json({ error: "Agreement not found" });
    const merged = { ...current, ...request.body, createdBy: current.createdBy } as Record<string, unknown>;
    const result = validateAgreementInput(merged, new Date());
    if (!result.ok) return response.status(422).json(result);
    return response.json(await repository.updateAgreement(String(request.params.id), walletRequest.walletAddress, request.body || {}));
  } catch (error) { return next(error); }
});
app.post("/agreements/:id/accept", agreementGuard, async (request: Request, response, next) => {
  try { const walletRequest = request as WalletRequest; const proposalId = String(request.body?.proposal_id || ""); if (!proposalId) return response.status(422).json({ error: "proposal_id is required" }); return response.json(await repository.acceptProposal(String(request.params.id), walletRequest.walletAddress, proposalId)); } catch (error) { return next(error); }
});
app.post("/agreements/:id/deploy-intent", agreementGuard, async (request: Request, response, next) => {
  try { const walletRequest = request as WalletRequest; return response.json(await repository.beginDeployment(String(request.params.id), walletRequest.walletAddress)); } catch (error) { return next(error); }
});
app.post("/agreements/:id/deployment-confirmation", agreementGuard, async (request: Request, response, next) => {
  try {
    const walletRequest = request as WalletRequest; const txHash = String(request.body?.txHash || "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return response.status(422).json({ error: "A valid deployment transaction hash is required" });
    if (!verifyDeployment) return response.status(503).json({ error: "Arc deployment verification is not configured" });
    const agreement = await repository.getAgreement(String(request.params.id));
    if (!agreement) return response.status(404).json({ error: "Agreement not found" });
    const verified = await verifyDeployment({ id: agreement.id, seller_address: agreement.sellerAddress, buyer_address: agreement.buyerAddress, arbitration_address: agreement.arbitrationAddress, operator_address: agreement.operatorAddress, total_usdc: agreement.totalUSDC, negotiation_expiry: agreement.negotiationExpiry, commitment_window_sec: agreement.commitmentWindowSec, arbitration_timeout_sec: agreement.arbitrationTimeoutSec }, txHash);
    return response.json(await repository.confirmDeployment(String(request.params.id), walletRequest.walletAddress, verified));
  } catch (error) { return next(error); }
});
app.post("/internal/onchain-state", async (request, response, next) => {
  try {
    if (!process.env.COMMERCIAL_REGISTRY_INTERNAL_TOKEN || request.header("x-registry-token") !== process.env.COMMERCIAL_REGISTRY_INTERNAL_TOKEN) return response.sendStatus(401);
    const { contractAddress, state, blockNumber } = request.body || {};
    if (!isAddress(contractAddress) || !["NEGOTIATION", "COMMITTED", "ACTIVE", "FINALIZED"].includes(state) || !Number.isInteger(Number(blockNumber))) return response.status(422).json({ error: "Invalid on-chain state update" });
    await repository.updateOnchainState(contractAddress, state, Number(blockNumber));
    return response.json({ ok: true });
  } catch (error) { return next(error); }
});
app.post("/internal/commitment-expired", async (request, response, next) => {
  try {
    if (!process.env.COMMERCIAL_REGISTRY_INTERNAL_TOKEN || request.header("x-registry-token") !== process.env.COMMERCIAL_REGISTRY_INTERNAL_TOKEN) return response.sendStatus(401);
    const { contractAddress, blockNumber } = request.body || {};
    if (!isAddress(contractAddress) || !Number.isInteger(Number(blockNumber))) return response.status(422).json({ error: "Invalid commitment expiry update" });
    await pool.query("UPDATE trade_agreements SET status = 'negotiating', negotiation_round = negotiation_round + 1, commitment_expired_at = now(), onchain_state = 'NEGOTIATION', last_indexed_block = $1, last_indexed_at = now() WHERE lower(contract_address) = lower($2)", [Number(blockNumber), contractAddress]);
    await pool.query("INSERT INTO negotiation_events (agreement_id,event_type,actor_address,note) SELECT id,'commitment_expired',operator_address,'Buyer commitment window expired on-chain' FROM trade_agreements WHERE lower(contract_address) = lower($1) AND status = 'negotiating'", [contractAddress]);
    return response.json({ ok: true });
  } catch (error) { return next(error); }
});
app.post("/internal/settlement-claims/claim", async (request, response, next) => {
  try {
    if (!process.env.COMMERCIAL_REGISTRY_INTERNAL_TOKEN || request.header("x-registry-token") !== process.env.COMMERCIAL_REGISTRY_INTERNAL_TOKEN) return response.sendStatus(401);
    const logicalKey = String(request.body?.logicalSettlementKey || "").trim();
    const ownerId = String(request.body?.ownerId || "").trim();
    if (!logicalKey || !ownerId || logicalKey.length > 500 || ownerId.length > 200) return response.status(422).json({ error: "logicalSettlementKey and ownerId are required" });
    const inserted = await pool.query("INSERT INTO relayer_settlement_claims (logical_settlement_key, owner_id) VALUES ($1,$2) ON CONFLICT (logical_settlement_key) DO NOTHING RETURNING logical_settlement_key", [logicalKey, ownerId]);
    if (inserted.rowCount) return response.json({ acquired: true, completed: false });
    const existing = await pool.query("SELECT owner_id, completed_at FROM relayer_settlement_claims WHERE logical_settlement_key = $1", [logicalKey]);
    if (!existing.rowCount) return response.status(409).json({ acquired: false, error: "Settlement claim disappeared during coordination" });
    const row = existing.rows[0];
    return response.json({ acquired: String(row.owner_id) === ownerId && !row.completed_at, completed: Boolean(row.completed_at), ownerId: row.owner_id });
  } catch (error) { return next(error); }
});
app.post("/internal/settlement-claims/complete", async (request, response, next) => {
  try {
    if (!process.env.COMMERCIAL_REGISTRY_INTERNAL_TOKEN || request.header("x-registry-token") !== process.env.COMMERCIAL_REGISTRY_INTERNAL_TOKEN) return response.sendStatus(401);
    const logicalKey = String(request.body?.logicalSettlementKey || "").trim();
    const ownerId = String(request.body?.ownerId || "").trim();
    if (!logicalKey || !ownerId) return response.status(422).json({ error: "logicalSettlementKey and ownerId are required" });
    const result = await pool.query("UPDATE relayer_settlement_claims SET completed_at = now() WHERE logical_settlement_key = $1 AND owner_id = $2 AND completed_at IS NULL", [logicalKey, ownerId]);
    return response.json({ completed: result.rowCount === 1 });
  } catch (error) { return next(error); }
});
app.get("/agreements/:id/diff/:proposalId", agreementGuard, async (request, response, next) => {
  try { return response.json(await repository.diff(String(request.params.id), String(request.params.proposalId))); } catch (error) { return next(error); }
});

async function agreementGuard(request: Request, response: Response, next: NextFunction) {
  try {
    const agreement = await repository.getAgreement(String(request.params.id));
    if (!agreement) { response.status(404).json({ error: "Agreement not found" }); return; }
    const actor = (request as WalletRequest).walletAddress;
    if (!await repository.getProfile(actor)) { response.status(409).json({ error: "Complete your company profile before accessing agreements" }); return; }
    if (actor !== String(agreement.buyerAddress || "").toLowerCase() && actor !== String(agreement.sellerAddress || "").toLowerCase()) { response.status(403).json({ error: "Only a known party can access this agreement" }); return; }
    request.params.id = agreement.id;
    next();
  } catch (error) { next(error); }
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected registry error";
  const status = (error as { status?: number })?.status || (/not found/i.test(message) ? 404 : /only the|already accepted|no longer|must agree|no pending|newer proposal|not pending/i.test(message) ? 409 : 400);
  response.status(status).json({ error: message });
});

const port = Number(process.env.PORT || 4000);
const isTestRuntime = process.env.NODE_ENV === "test" || process.argv.includes("--test");
if (!isTestRuntime) {
  void validateDeploymentConfiguration()
    .then(() => app.listen(port, "0.0.0.0", () => console.log(`Commercial registry listening on ${port}`)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
export { app, pool };
