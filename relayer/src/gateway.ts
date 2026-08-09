import axios, { type AxiosInstance } from "axios";
import type { GatewayClient, GatewayResult } from "./types.js";

export class CircleGatewayClient implements GatewayClient {
  private readonly http: AxiosInstance;

  public constructor(baseUrl: string, timeoutMs = 15_000) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      validateStatus: () => true,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  public async submit(input: import("./types.js").GatewayTransferRequest): Promise<GatewayResult> {
    const response = await this.http.post("/v1/transfer", [input]);
    return { status: response.status, body: response.data };
  }

  public async getTransfer(transferId: string): Promise<GatewayResult> {
    const response = await this.http.get(`/v1/transfer/${encodeURIComponent(transferId)}`);
    return { status: response.status, body: response.data };
  }
}
