import { BrowserProvider, type Eip1193Provider, type JsonRpcSigner } from "ethers";

export interface EmbeddedWalletSession { address: string; provider: Eip1193Provider; signer: JsonRpcSigner; }
export interface EmbeddedWalletAdapter { getSession(): Promise<EmbeddedWalletSession | null>; login(): Promise<EmbeddedWalletSession>; logout(): Promise<void>; onAccountChange(listener: (address?: string) => void): () => void; }
type CircleBridge = { login(): Promise<{ address: string; provider: Eip1193Provider }>; logout(): Promise<void>; getProvider(): Eip1193Provider; getAddress(): Promise<string>; on(event: "accountChanged", listener: (address?: string) => void): () => void; };
declare global { interface Window { circleEmbeddedWallet?: CircleBridge } }

export function createCircleEmbeddedWalletAdapter(): EmbeddedWalletAdapter {
  const bridge = () => window.circleEmbeddedWallet;
  const session = async (): Promise<EmbeddedWalletSession | null> => { const b = bridge(); if (!b) return null; const address = await b.getAddress().catch(() => ""); if (!address) return null; const provider = b.getProvider(); return { address, provider, signer: await new BrowserProvider(provider).getSigner() }; };
  return { getSession: session, async login() { const b = bridge(); if (!b) throw new Error("Embedded sign-in is not configured"); const result = await b.login(); const provider = result.provider || b.getProvider(); return { address: result.address, provider, signer: await new BrowserProvider(provider).getSigner() }; }, async logout() { await bridge()?.logout(); }, onAccountChange(listener) { return bridge()?.on("accountChanged", listener) || (() => undefined); } };
}
