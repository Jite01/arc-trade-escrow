import { Contract, Interface, JsonRpcProvider, type ContractTransactionResponse } from "ethers";
import { config } from "./config";
import type { CircleSigner } from "./wallet";

export type Role = "BUYER" | "SELLER" | "ARBITRATOR" | "READ_ONLY";
export type Terms = { buyer: string; seller: string; arbitrator: string; total: bigint; negotiationExpiry: bigint; commitmentWindow: bigint; arbitrationTimeout: bigint; };
export type Milestone = { description: string; basisPoints: bigint; sellerDeadline: bigint; buyerResponseWindow: bigint; disputeWindow: bigint; state: number; documentHash: string; triggerAt: bigint; confirmAt: bigint; disputeAt: bigint; releaseAt: bigint; windowDeadline: bigint; amount: bigint; };
export type AgreementRecord = { id: string; escrow: string; buyer: string; seller: string; arbitrator: string; createdAt: bigint; };

export const readProvider = new JsonRpcProvider(config.rpcUrl);
export const factoryFor = (signer?: CircleSigner) => new Contract(config.factoryAddress, config.factoryAbi, signer || readProvider);
export const contractFor = (address: string, signer?: CircleSigner) => new Contract(address, config.escrowAbi, signer || readProvider);
const factoryInterface = new Interface(config.factoryAbi);
const pick = (value: any, index: number) => value?.[index] ?? value;
const AGREEMENT_READ_TIMEOUT_MS = 60000;
const withTimeout = <T>(promise: Promise<T>, label: string): Promise<T> => new Promise((resolve, reject) => {
  const timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), AGREEMENT_READ_TIMEOUT_MS);
  promise.then(value => { window.clearTimeout(timer); resolve(value); }, error => { window.clearTimeout(timer); reject(error); });
});

export async function getAgreement(id: string): Promise<AgreementRecord | null> {
  const raw: any = await factoryFor().getAgreement(id);
  const escrow = String(pick(raw, 0));
  if (!escrow || /^0x0{40}$/i.test(escrow)) return null;
  return { id, escrow, buyer: String(pick(raw, 1)), seller: String(pick(raw, 2)), arbitrator: String(pick(raw, 3)), createdAt: BigInt(pick(raw, 4)) };
}

export async function agreementsFor(address: string): Promise<AgreementRecord[]> {
  const ids = await factoryFor().agreementsOf(address) as string[];
  const records = await Promise.all(ids.map(id => getAgreement(id)));
  return records.filter((record): record is AgreementRecord => Boolean(record)).reverse();
}

export async function createAgreement(signer: CircleSigner, id: string, seller: string, total: bigint, negotiationExpiry: bigint, commitmentWindow: bigint, arbitrationTimeout: bigint): Promise<AgreementRecord> {
  const tx = await factoryFor(signer).createAgreement(id, seller, total, negotiationExpiry, commitmentWindow, arbitrationTimeout) as ContractTransactionResponse;
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Agreement creation receipt unavailable");
  for (const log of receipt.logs) {
    try {
      const parsed = factoryInterface.parseLog(log);
      if (parsed?.name === "AgreementCreated") {
        return { id: String(parsed.args[0]), escrow: String(parsed.args[1]), buyer: String(parsed.args[2]), seller: String(parsed.args[3]), arbitrator: String(parsed.args[4]), createdAt: BigInt(Math.floor(Date.now() / 1000)) };
      }
    } catch { /* ignore logs from unrelated contracts */ }
  }
  const record = await getAgreement(id);
  if (!record) throw new Error("Agreement was created but could not be indexed");
  return record;
}

export async function readAgreement(address: string) {
  const c = contractFor(address);
  const [state, termsRaw, msRaw, approvals, balances, current] = await withTimeout(Promise.all([c.getState(), c.getTerms(), c.getMilestones(), c.getApprovals(), c.getBalances(), c.getCurrentMilestoneIndex()]), "Agreement read");
  const terms: Terms = { buyer: pick(termsRaw, 0), seller: pick(termsRaw, 1), arbitrator: pick(termsRaw, 2), total: BigInt(pick(termsRaw, 4)), negotiationExpiry: BigInt(pick(termsRaw, 5)), commitmentWindow: BigInt(pick(termsRaw, 6)), arbitrationTimeout: BigInt(pick(termsRaw, 7)) };
  const milestones: Milestone[] = [];
  for (let i = 0; i < msRaw.length; i++) { const m = msRaw[i]; const s = await withTimeout(c.getMilestoneStatus(i), `Milestone ${i + 1} read`); milestones.push({ description: m.description, basisPoints: BigInt(m.basisPoints), sellerDeadline: BigInt(m.sellerDeadline), buyerResponseWindow: BigInt(m.buyerResponseWindow), disputeWindow: BigInt(m.disputeWindow), state: Number(pick(s, 0)), documentHash: pick(s, 1), triggerAt: BigInt(pick(s, 2)), confirmAt: BigInt(pick(s, 3)), disputeAt: BigInt(pick(s, 4)), releaseAt: BigInt(pick(s, 5)), windowDeadline: BigInt(pick(s, 6)), amount: BigInt(pick(s, 7)) }); }
  return { state: Number(state), terms, milestones, approvals: { buyer: Boolean(pick(approvals, 0)), seller: Boolean(pick(approvals, 1)), version: Number(pick(approvals, 2)) }, balances: { released: BigInt(pick(balances, 0)), remaining: BigInt(pick(balances, 1)), disputed: BigInt(pick(balances, 2)) }, current: Number(current) };
}

export function roleFor(address: string, terms: Terms): Role { const a = address.toLowerCase(); if (a === terms.buyer.toLowerCase()) return "BUYER"; if (a === terms.seller.toLowerCase()) return "SELLER"; if (a === terms.arbitrator.toLowerCase()) return "ARBITRATOR"; return "READ_ONLY"; }
export function call(signer: CircleSigner, address: string, name: string, ...args: any[]): Promise<ContractTransactionResponse> { return (contractFor(address, signer) as any)[name](...args); }
export function errorMessage(error: unknown, action?: string): string { const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : ""; const text = String(error).toLowerCase(); if (text.includes("already linked to")) return String(error instanceof Error ? error.message : "This passkey is already linked to another company. Enter that company name to continue."); if (code === "CONFIGURATION") return "Circle rejected this site’s credentials. Use the current Client Key and add arc-trade-escrow.vercel.app as both the Allowed Domain and Passkey Domain in Circle Console."; if (code === "UNSUPPORTED") return "This browser can’t complete secure sign-in. Use a current browser with device authentication enabled."; if (code === "CANCELLED") return "Sign-in was cancelled."; if (code === "FAILED" && action === "signIn") return "We couldn’t complete sign-in. Check the current Circle Client Key and add arc-trade-escrow.vercel.app as both the Allowed Domain and Passkey Domain in Circle Console."; if (code === "FAILED") return "We couldn’t complete sign-in. Please try again."; if (action === "loadAgreement") return "We couldn’t load the trade agreement. Please try again."; if (text.includes("timed out") || text.includes("timeout")) return "We couldn’t load the trade agreement. Please try again."; if (text.includes("unauthorized") || text.includes("not authorized")) return "This action isn’t available for your account."; if (text.includes("agreementexists")) return "That agreement ID is already in use."; if (text.includes("invalidaddress")) return "Enter a different participant wallet address."; if (text.includes("invalidstate") || text.includes("invalidmilestonestate")) return "This has already been completed."; if (action === "approve") return "We couldn’t authorise the payment. Please try again."; if (action === "depositUSDS") return "There was a problem securing the funds. Please try again."; return "Something went wrong. Please try again or contact support."; }
export function eventInterface() { return new Interface(config.escrowAbi); }
