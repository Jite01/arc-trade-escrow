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

export interface EmbeddedWalletSession { address: string; signer: CircleSigner; }
export interface EmbeddedWalletAdapter { getSession(): Promise<EmbeddedWalletSession | null>; login(): Promise<EmbeddedWalletSession>; logout(): Promise<void>; onAccountChange(listener: (address?: string) => void): () => void; }

const clientKey = import.meta.env.VITE_CLIENT_KEY;
const clientUrl = import.meta.env.VITE_CLIENT_URL;
const usernameKey = "arc-trade-passkey-username";
type Bundler = any;

export class CircleSigner extends AbstractSigner {
  public constructor(private readonly address: string, private readonly bundler: Bundler, provider?: Provider) { super(provider); }
  public async getAddress(): Promise<string> { return this.address; }
  public connect(provider: Provider | null): CircleSigner { return new CircleSigner(this.address, this.bundler, provider ?? undefined); }
  public async signTransaction(): Promise<string> { throw new Error("The Circle passkey signs through the transaction approval flow"); }
  public async signMessage(): Promise<string> { throw new Error("The Circle passkey signs through the transaction approval flow"); }
  public async signTypedData(_domain: TypedDataDomain, _types: Record<string, Array<TypedDataField>>, _value: Record<string, unknown>): Promise<string> { throw new Error("The Circle passkey signs through the transaction approval flow"); }
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
    async login() {
      if (!clientKey || !clientUrl) throw new Error("Circle client configuration is missing");
      const username = window.prompt("Enter your sign-in name")?.trim();
      if (!username) throw new Error("Sign-in was cancelled");
      const mode = localStorage.getItem(usernameKey) === username ? WebAuthnMode.Login : WebAuthnMode.Register;
      const passkeyTransport = toPasskeyTransport(clientUrl, clientKey);
      const credential = await toWebAuthnCredential({ transport: passkeyTransport, mode, username });
      const modularTransport = toModularTransport(`${clientUrl}/arcTestnet`, clientKey);
      const client = createPublicClient({ chain: arcTestnet, transport: modularTransport });
      const smartAccount = await toCircleSmartAccount({ client, owner: toWebAuthnAccount({ credential }) });
      const bundler = createBundlerClient({ account: smartAccount, chain: arcTestnet, transport: modularTransport });
      active = { address: smartAccount.address, signer: new CircleSigner(smartAccount.address, bundler) };
      localStorage.setItem(usernameKey, username);
      listeners.forEach(listener => listener(active?.address));
      return active;
    },
    async logout() { active = null; listeners.forEach(listener => listener(undefined)); },
    onAccountChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
