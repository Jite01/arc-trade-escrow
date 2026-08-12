import express, { type NextFunction, type Request, type Response } from "express";
import { Pool } from "pg";
import { createWalletAuth, type WalletRequest } from "./auth.js";
import { createRepository } from "./repository.js";
import { validateAgreementInput, validateProposalMilestones, isAddress } from "./validation.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DATABASE_POOL_MAX || 10), ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });
const repository = createRepository(pool);
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
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
app.use(walletAuth.middleware);

app.post("/agreements", async (request: Request, response, next) => {
  try {
    const walletRequest = request as WalletRequest;
    const input = request.body as Record<string, unknown>;
    const result = validateAgreementInput(input, new Date());
    if (!result.ok) return response.status(422).json(result);
    if (String(input.createdBy || walletRequest.walletAddress).toLowerCase() !== walletRequest.walletAddress) return response.status(403).json({ error: "createdBy must match the authenticated wallet" });
    const buyer = String(input.buyerAddress || "").toLowerCase();
    const seller = String(input.sellerAddress || "").toLowerCase();
    if (walletRequest.walletAddress !== buyer && walletRequest.walletAddress !== seller) return response.status(403).json({ error: "The authenticated wallet must be the buyer or seller" });
    const agreement = await repository.createAgreement(input as never, walletRequest.walletAddress);
    return response.status(201).json({ agreementId: agreement.id, referenceCode: agreement.referenceCode, agreement });
  } catch (error) { return next(error); }
});

app.get("/agreements/:id", agreementGuard, async (request: Request, response, next) => {
  try { const agreement = await repository.getAgreement(String(request.params.id)); return agreement ? response.json(agreement) : response.status(404).json({ error: "Agreement not found" }); } catch (error) { return next(error); }
});
app.get("/agreements/:id/proposals", agreementGuard, async (request, response, next) => {
  try { return response.json(await repository.listProposals(String(request.params.id))); } catch (error) { return next(error); }
});
app.post("/agreements/:id/proposals", agreementGuard, async (request: Request, response, next) => {
  try { const walletRequest = request as WalletRequest; const result = validateProposalMilestones(request.body?.milestones); if (!result.ok) return response.status(422).json(result); return response.status(201).json(await repository.createProposal(String(request.params.id), walletRequest.walletAddress, request.body)); } catch (error) { return next(error); }
});
app.post("/agreements/:id/accept", agreementGuard, async (request: Request, response, next) => {
  try { const walletRequest = request as WalletRequest; return response.json(await repository.acceptProposal(String(request.params.id), walletRequest.walletAddress)); } catch (error) { return next(error); }
});
app.post("/agreements/:id/deploy", agreementGuard, async (request: Request, response, next) => {
  try { const walletRequest = request as WalletRequest; const { contractAddress, deploymentBlock } = request.body || {}; if (!isAddress(contractAddress) || !Number.isInteger(Number(deploymentBlock)) || Number(deploymentBlock) < 0) return response.status(422).json({ error: "contractAddress and deploymentBlock are required" }); return response.json(await repository.recordDeployment(String(request.params.id), walletRequest.walletAddress, contractAddress, Number(deploymentBlock))); } catch (error) { return next(error); }
});
app.get("/agreements/:id/diff/:proposalId", agreementGuard, async (request, response, next) => {
  try { return response.json(await repository.diff(String(request.params.id), String(request.params.proposalId))); } catch (error) { return next(error); }
});

async function agreementGuard(request: Request, response: Response, next: NextFunction) {
  try {
    const agreement = await repository.getAgreement(String(request.params.id));
    if (!agreement) { response.status(404).json({ error: "Agreement not found" }); return; }
    const actor = (request as WalletRequest).walletAddress;
    if (actor !== agreement.buyerAddress.toLowerCase() && actor !== agreement.sellerAddress.toLowerCase()) { response.status(403).json({ error: "Only the buyer or seller can access this agreement" }); return; }
    next();
  } catch (error) { next(error); }
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected registry error";
  const status = /not found/i.test(message) ? 404 : /only the|already accepted|no longer|must agree|no pending/i.test(message) ? 409 : 400;
  response.status(status).json({ error: message });
});

const port = Number(process.env.PORT || 4000);
if (process.env.NODE_ENV !== "test") app.listen(port, "0.0.0.0", () => console.log(`Commercial registry listening on ${port}`));
export { app, pool };
