import axios, { type AxiosInstance } from "axios";
import type { GatewayClient, GatewayResult } from "./types.js";

export class CircleGatewayClient implements GatewayClient {
  private readonly http: AxiosInstance;

  public constructor(baseUrl: string, apiKey: string, timeoutMs = 15_000) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      validateStatus: () => true,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });
  }

  public async submit(input: { contractAddress: string; transferHash: string; recipient: string; amount: string }): Promise<GatewayResult> {
    const response = await this.http.post("/v1/transfer", {
      contractAddress: input.contractAddress,
      contractSigner: true,
      hash: input.transferHash,
      recipient: input.recipient,
      amount: input.amount,
      chain: "arc-testnet"
    });
    return { status: response.status, body: response.data };
  }
}
