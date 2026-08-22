import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import { Contract, JsonRpcProvider, hashMessage } from "ethers";
import { isAddress } from "./validation.js";

export type WalletRequest = Request & { walletAddress: string };
type AuthPayload = { sub: string; exp: number; jti: string };
const MAGIC_VALUE = "0x1626ba7e";
const CIRCLE_ACCOUNT_FACTORY = "0x0000000DF7E6c9Dc387cAFc5eCBfa6c3a6179AdD";
const challengeLifetimeSec = 5 * 60;
const sessionLifetimeSec = 60 * 60;
const signatureAbi = ["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"];

export function createWalletAuth(pool: Pool) {
  const secret = process.env.CIRCLE_WALLET_AUTH_SECRET || "";
  const rpcUrl = process.env.ARC_RPC_URL || "";
  const provider = rpcUrl ? new JsonRpcProvider(rpcUrl) : null;

  return {
    async challenge(address: string, origin: string) {
      requireConfigured(secret, provider);
      const walletAddress = address.toLowerCase();
      const expiresAt = new Date(Date.now() + challengeLifetimeSec * 1000);
      const message = [
        "Arc Trade commercial registry sign-in",
        `Wallet: ${walletAddress}`,
        `Origin: ${origin}`,
        `Issued at: ${new Date().toISOString()}`,
        `Expires at: ${expiresAt.toISOString()}`,
      ].join("\n");
      const result = await pool.query("INSERT INTO auth_challenges (wallet_address,message,expires_at) VALUES ($1,$2,$3) RETURNING id,expires_at", [walletAddress, message, expiresAt.toISOString()]);
      return { challengeId: result.rows[0].id as string, message, expiresAt: new Date(result.rows[0].expires_at).toISOString() };
    },

    async verify(challengeId: string, address: string, signature: string) {
      requireConfigured(secret, provider);
      if (!isAddress(address) || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new Error("Invalid wallet authentication payload");
      const challenge = await pool.query("SELECT * FROM auth_challenges WHERE id = $1 AND lower(wallet_address) = lower($2) AND used_at IS NULL AND expires_at > now()", [challengeId, address]);
      if (!challenge.rowCount) throw new Error("Wallet sign-in challenge is invalid or expired");
      const row = challenge.rows[0] as { id: string; wallet_address: string; message: string };
      const contract = new Contract(row.wallet_address, signatureAbi, provider);
      const result = String(await contract.isValidSignature(hashMessage(row.message), signature));
      if (result.toLowerCase() !== MAGIC_VALUE) throw new Error("Wallet signature could not be verified");
      const consumed = await pool.query("UPDATE auth_challenges SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id", [row.id]);
      if (!consumed.rowCount) throw new Error("Wallet sign-in challenge has already been used");
      const now = Math.floor(Date.now() / 1000);
      const payload: AuthPayload = { sub: row.wallet_address.toLowerCase(), exp: now + sessionLifetimeSec, jti: randomUUID() };
      return { accessToken: signToken(payload, secret), expiresAt: new Date((now + sessionLifetimeSec) * 1000).toISOString(), walletAddress: payload.sub };
    },

    async verifyCounterfactual(address: string, accountFactory: string, accountFactoryData: string) {
      requireConfigured(secret, provider);
      if (!provider) throw new Error("ARC_RPC_URL is required for wallet signature verification");
      if (!isAddress(address) || accountFactory.toLowerCase() !== (process.env.CIRCLE_ACCOUNT_FACTORY_ADDRESS || CIRCLE_ACCOUNT_FACTORY).toLowerCase() || !/^0x[0-9a-fA-F]+$/.test(accountFactoryData)) throw new Error("Invalid Circle account proof");
      const factory = new Contract(accountFactory, ["function getAddress(bytes32 sender, bytes32 salt, bytes initializingData) view returns (address addr, bytes32 mixedSalt)", "function createAccount(bytes32 sender, bytes32 salt, bytes initializingData)"], provider);
      const decoded = factory.interface.decodeFunctionData("createAccount", accountFactoryData);
      const result = await provider.call({ to: accountFactory, data: factory.interface.encodeFunctionData("getAddress", [decoded[0], decoded[1], decoded[2]]) });
      const derived = String(factory.interface.decodeFunctionResult("getAddress", result)[0]);
      if (derived.toLowerCase() !== address.toLowerCase()) throw new Error("Circle account proof does not match wallet address");
      const now = Math.floor(Date.now() / 1000);
      const payload: AuthPayload = { sub: address.toLowerCase(), exp: now + sessionLifetimeSec, jti: randomUUID() };
      return { accessToken: signToken(payload, secret), expiresAt: new Date((now + sessionLifetimeSec) * 1000).toISOString(), walletAddress: payload.sub };
    },

    middleware(request: Request, response: Response, next: NextFunction): void {
      try {
        requireConfigured(secret, provider);
        const token = String(request.header("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
        const payload = verifyToken(token, secret);
        (request as WalletRequest).walletAddress = payload.sub;
        next();
      } catch (error) {
        response.status(401).json({ error: error instanceof Error ? error.message : "Wallet authentication failed" });
      }
    }
  };
}

function requireConfigured(secret: string, provider: JsonRpcProvider | null): void {
  if (!secret || secret === "replace-me") throw new Error("Wallet authentication is not configured");
  if (!provider) throw new Error("ARC_RPC_URL is required for wallet signature verification");
}

function signToken(payload: AuthPayload, secret: string): string {
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${hmac(encoded, secret)}`;
}

function verifyToken(token: string, secret: string): AuthPayload {
  const [encoded, provided] = token.split(".");
  if (!encoded || !provided || !constantTimeEqual(provided, hmac(encoded, secret))) throw new Error("Bearer token is invalid");
  let payload: AuthPayload;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AuthPayload; } catch { throw new Error("Bearer token is invalid"); }
  if (!payload || !isAddress(payload.sub) || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) throw new Error("Bearer token is expired");
  return payload;
}

function hmac(value: string, secret: string): string { return createHmac("sha256", secret).update(value).digest("hex"); }
function base64url(value: string): string { return Buffer.from(value).toString("base64url"); }
function constantTimeEqual(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
