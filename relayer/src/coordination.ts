import type { SettlementCoordinator } from "./types.js";

type ClaimResponse = { acquired?: boolean; completed?: boolean };

export class HttpSettlementCoordinator implements SettlementCoordinator {
  private readonly baseUrl: string;
  public constructor(private readonly registryUrl: string, private readonly token: string) {
    this.baseUrl = registryUrl.replace(/\/+$/, "");
  }

  public async claim(logicalSettlementKey: string, ownerId: string): Promise<boolean> {
    const response = await this.request("/internal/settlement-claims/claim", { logicalSettlementKey, ownerId });
    if (!response.ok) throw new Error(`Distributed settlement claim failed with HTTP ${response.status}`);
    const body = await response.json() as ClaimResponse;
    return body.acquired === true && body.completed !== true;
  }

  public async complete(logicalSettlementKey: string, ownerId: string): Promise<void> {
    const response = await this.request("/internal/settlement-claims/complete", { logicalSettlementKey, ownerId });
    if (!response.ok) throw new Error(`Distributed settlement completion failed with HTTP ${response.status}`);
  }

  private request(path: string, body: Record<string, string>): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-registry-token": this.token }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  }
}
