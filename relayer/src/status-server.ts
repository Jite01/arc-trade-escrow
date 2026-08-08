import { createServer, type Server } from "node:http";
import type { Relayer } from "./relayer.js";

export class StatusServer {
  private server: Server | undefined;
  private readonly startedAt = Date.now();

  public constructor(private readonly relayer: Relayer, private readonly port: number) {}

  public async start(): Promise<void> {
    if (this.server) return;
    this.server = createServer((request, response) => {
      const url = new URL(request.url || "/", "http://localhost");
      if (request.method !== "GET") return this.respond(response, 405, { error: "Method not allowed" });
      if (url.pathname === "/status") {
        return this.respond(response, 200, {
          contractAddress: this.relayer.config.contractAddress,
          listening: this.relayer.listening,
          uptime: Math.floor((Date.now() - this.startedAt) / 1000),
          transfers: this.relayer.database.counts()
        });
      }
      if (url.pathname === "/transfers") return this.respond(response, 200, this.relayer.database.all());
      if (url.pathname.startsWith("/settlements/") || url.pathname.startsWith("/transfers/")) {
        const key = decodeURIComponent(url.pathname.slice(url.pathname.startsWith("/settlements/") ? "/settlements/".length : "/transfers/".length));
        const row = this.relayer.database.get(key);
        return this.respond(response, row ? 200 : 404, row || { error: "Settlement not found" });
      }
      return this.respond(response, 404, { error: "Not found" });
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.port, "0.0.0.0", () => resolve());
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => this.server?.close((error) => (error ? reject(error) : resolve())));
    this.server = undefined;
  }

  private respond(response: import("node:http").ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  }
}
