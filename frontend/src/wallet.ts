import {
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  WebAuthnMode,
} from "@circle-fin/modular-wallets-core";
import { arcTestnet } from "viem/chains";
import { createPublicClient } from "viem";
import { createBundlerClient, toWebAuthnAccount } from "viem/account-abstraction";
import { AbstractSigner, type Provider, type TransactionRequest, type TransactionResponse, type TypedDataDomain, type TypedDataField } from "ethers";

export interface EmbeddedWalletSession { address: string; signer: CircleSigner; credentialId: string; }
export type CircleLoginMode = "register" | "login";
export interface EmbeddedWalletAdapter { getSession(): Promise<EmbeddedWalletSession | null>; login(companyName: string, mode: CircleLoginMode): Promise<EmbeddedWalletSession>; rememberCredential(companyName: string, credentialId: string): void; logout(): Promise<void>; onAccountChange(listener: (address?: string) => void): () => void; }
export type CircleSignInErrorCode = "CONFIGURATION" | "UNSUPPORTED" | "CANCELLED" | "FAILED";

export class CircleSignInError extends Error {
  public constructor(public readonly code: CircleSignInErrorCode, cause?: unknown) {
    super(code);
    this.name = "CircleSignInError";
    if (cause !== undefined) this.cause = cause;
  }
}

const clientKey = import.meta.env.VITE_CLIENT_KEY;
const clientUrl = import.meta.env.VITE_CLIENT_URL;
type Bundler = any;

// Circle's passkey username is an identifier, not the display name shown in
// the registry. Keep company names human-friendly while giving Circle a
// stable, valid value even for names containing spaces or fewer than five
// characters (for example, "Bose").
export function passkeyUsername(companyName: string): string {
  const normalized = companyName.trim().replace(/[^a-zA-Z0-9_@.:+-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
  const padded = normalized.length >= 5 ? normalized : `${normalized || "company"}-co`;
  return padded.slice(0, 50);
}
const credentialStorageKey = (companyName: string) => `arc-trade-credential:${passkeyUsername(companyName).toLowerCase()}`;

function signInError(error: unknown): CircleSignInError {
  if (error instanceof CircleSignInError) return error;
  const text = String(error).toLowerCase();
  if (text.includes("notallowederror") || text.includes("aborterror") || text.includes("cancelled") || text.includes("canceled")) return new CircleSignInError("CANCELLED", error);
  if (text.includes("credential management api not supported") || text.includes("publickeycredential") || text.includes("not supported")) return new CircleSignInError("UNSUPPORTED", error);
  if (text.includes("invalid credentials") || text.includes("client key") || text.includes("client configuration") || text.includes("entity") || text.includes("domain") || text.includes("origin") || text.includes("rp id") || text.includes("registration options") || text.includes("login options")) return new CircleSignInError("CONFIGURATION", error);
  return new CircleSignInError("FAILED", error);
}

function validateConfiguration(): void {
  if (!clientKey || !clientUrl) throw new CircleSignInError("CONFIGURATION");
  try {
    const url = new URL(clientUrl);
    if (url.protocol !== "https:") throw new Error("Unsupported protocol");
  } catch (error) {
    throw new CircleSignInError("CONFIGURATION", error);
  }
  if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials) throw new CircleSignInError("UNSUPPORTED");
}

export class CircleSigner extends AbstractSigner {
  public constructor(private readonly address: string, private readonly bundler: Bundler, private readonly account: any, provider?: Provider) { super(provider); }
  public async getAddress(): Promise<string> { return this.address; }
  public connect(provider: Provider | null): CircleSigner { return new CircleSigner(this.address, this.bundler, this.account, provider ?? undefined); }
  public async signTransaction(): Promise<string> { throw new Error("The Circle passkey signs through the transaction approval flow"); }
  public async signMessage(message: string | Uint8Array): Promise<string> { return this.account.signMessage({ message: typeof message === "string" ? message : new TextDecoder().decode(message) }); }
  public async signTypedData(domain: TypedDataDomain, types: Record<string, Array<TypedDataField>>, value: Record<string, unknown>): Promise<string> { return this.account.signTypedData({ domain, types, primaryType: Object.keys(types)[0], message: value }); }
  public async sendTransaction(request: TransactionRequest): Promise<TransactionResponse> {
    if (!request.to) throw new Error("A contract destination is required");
    const userOpHash = await this.bundler.sendUserOperation({ calls: [{ to: request.to, data: request.data ?? "0x", value: request.value ?? 0n }], paymaster: true });
    const result = await this.bundler.waitForUserOperationReceipt({ hash: userOpHash });
    const hash = result.receipt.transactionHash as string;
    return { hash, from: this.address, confirmations: 0, blockNumber: result.receipt.blockNumber, blockHash: result.receipt.blockHash, timestamp: undefined, nonce: 0, gasLimit: 0n, gasPrice: 0n, maxPriorityFeePerGas: null, maxFeePerGas: null, data: request.data ?? "0x", value: request.value ?? 0n, to: request.to, chainId: 5042002, type: 2, accessList: [], wait: async () => ({ ...result.receipt, hash, confirmations: 1 }) } as unknown as TransactionResponse;
  }
}

let active: EmbeddedWalletSession | null = null;
const listeners = new Set<(address?: string) => void>();

export function createCircleEmbeddedWalletAdapter(): EmbeddedWalletAdapter {
  return {
    async getSession() { return active; },
    async login(companyName, mode) {
      validateConfiguration();
      const username = passkeyUsername(companyName);
      if (!username) throw new CircleSignInError("CONFIGURATION");
      const passkeyTransport = toPasskeyTransport(clientUrl, clientKey);
      try {
        const credentialId = mode === "login" ? localStorage.getItem(credentialStorageKey(companyName)) || undefined : undefined;
        const credential = await toWebAuthnCredential({ transport: passkeyTransport, mode: mode === "register" ? WebAuthnMode.Register : WebAuthnMode.Login, username, credentialId });
        const modularTransport = toModularTransport(`${clientUrl.replace(/\/$/, "")}/arcTestnet`, clientKey);
        const client = createPublicClient({ chain: arcTestnet, transport: modularTransport });
        const smartAccount = await toCircleSmartAccount({ client, owner: toWebAuthnAccount({ credential }) });
        const bundler = createBundlerClient({ account: smartAccount, chain: arcTestnet, transport: modularTransport });
        active = { address: smartAccount.address, signer: new CircleSigner(smartAccount.address, bundler, smartAccount), credentialId: credential.id };
        if (mode === "register") localStorage.setItem(credentialStorageKey(companyName), credential.id);
        console.info("Circle participant account:", smartAccount.address, "sign-in name:", username);
        return active;
      } catch (error) {
        console.error("Circle passkey sign-in failed", error);
        throw signInError(error);
      }
    },
    rememberCredential(companyName, credentialId) { if (credentialId) localStorage.setItem(credentialStorageKey(companyName), credentialId); },
    async logout() { active = null; listeners.forEach(listener => listener(undefined)); },
    onAccountChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
