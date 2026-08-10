import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Relayer } from "./relayer.js";

export class StatusServer {
  private server: Server | undefined;
  private readonly startedAt = Date.now();

  public constructor(private readonly relayer: Relayer, private readonly port: number) {}

  public async start(): Promise<void> {
    if (this.server) return;
    this.server = createServer((request, response) => void this.handle(request, response));
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

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url || "/", "http://localhost");
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (request.method === "OPTIONS") return this.respond(response, 204, null);
    try {
      if (request.method === "GET") return this.get(url, response);
      if (request.method === "POST") return this.post(url, request, response);
      return this.respond(response, 405, { error: "Method not allowed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /already registered|already exists|unique|another account/i.test(message) ? 409 : 400;
      return this.respond(response, status, { error: message });
    }
  }

  private get(url: URL, response: ServerResponse): void {
    if (url.pathname === "/status") return this.respond(response, 200, {
      contractAddress: this.relayer.config.factoryAddress,
      factoryAddress: this.relayer.config.factoryAddress,
      listening: this.relayer.listening,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      transfers: this.relayer.database.counts()
    });
    if (url.pathname === "/transfers") return this.respond(response, 200, this.relayer.database.all());
    if (url.pathname === "/companies/lookup") {
      const name = url.searchParams.get("name") || "";
      const company = this.relayer.database.getCompany(name);
      return this.respond(response, company ? 200 : 404, company || { error: "Company not found" });
    }
    if (url.pathname === "/companies/by-wallet") {
      const address = url.searchParams.get("address") || "";
      const company = this.relayer.database.getCompanyByWallet(address);
      return this.respond(response, company ? 200 : 404, company || { error: "Company not found" });
    }
    if (url.pathname === "/proposals/public") return this.respond(response, 200, this.relayer.database.publicProposals(Math.floor(Date.now() / 1000)));
    if (url.pathname.startsWith("/proposals/company/")) return this.respond(response, 200, this.relayer.database.proposalsForCompany(decodeURIComponent(url.pathname.slice("/proposals/company/".length)), Math.floor(Date.now() / 1000)));
    if (url.pathname.startsWith("/proposals/")) {
      const proposal = this.relayer.database.getProposal(decodeURIComponent(url.pathname.slice("/proposals/".length)));
      return this.respond(response, proposal ? 200 : 404, proposal || { error: "Proposal not found" });
    }
    if (url.pathname.startsWith("/settlements/") || url.pathname.startsWith("/transfers/")) {
      const prefix = url.pathname.startsWith("/settlements/") ? "/settlements/" : "/transfers/";
      const key = decodeURIComponent(url.pathname.slice(prefix.length));
      const row = this.relayer.database.get(key);
      return this.respond(response, row ? 200 : 404, row || { error: "Settlement not found" });
    }
    return this.respond(response, 404, { error: "Not found" });
  }

  private async post(url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await this.body(request);
    const now = Math.floor(Date.now() / 1000);
    if (url.pathname === "/companies") {
      const company = this.relayer.database.registerCompany(String(body.name || ""), String(body.walletAddress || ""), now);
      return this.respond(response, 200, company);
    }
    if (url.pathname === "/proposals") {
      const proposal = this.relayer.database.createProposal({
        id: String(body.id || randomUUID()),
        proposerCompany: String(body.proposerCompany || ""),
        proposerAddress: String(body.proposerAddress || ""),
        recipientCompany: body.recipientCompany ? String(body.recipientCompany) : null,
        visibility: body.visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC",
        title: String(body.title || "Documentary trade agreement"),
        description: String(body.description || ""),
        totalUSDC: String(body.totalUSDC || "0"),
        sellerCommitmentWindow: Number(body.sellerCommitmentWindow || 3600),
        buyerResponseWindow: Number(body.buyerResponseWindow || 900),
        disputeWindow: Number(body.disputeWindow || 900),
        proposalExpiresAt: Number(body.proposalExpiresAt || now + 3600),
        milestones: Array.isArray(body.milestones) ? body.milestones : []
      }, now);
      return this.respond(response, 201, proposal);
    }
    const bind = url.pathname.match(/^\/proposals\/([^/]+)\/bind$/);
    if (bind) {
      const proposal = this.relayer.database.bindProposal(decodeURIComponent(bind[1]), String(body.agreementId || ""), String(body.escrowAddress || ""), now);
      return this.respond(response, proposal ? 200 : 404, proposal || { error: "Proposal not found" });
    }
    const accept = url.pathname.match(/^\/proposals\/([^/]+)\/accept$/);
    if (accept) {
      const proposal = this.relayer.database.acceptProposal(decodeURIComponent(accept[1]), String(body.company || ""), String(body.walletAddress || ""), now);
      return this.respond(response, proposal ? 200 : 404, proposal || { error: "Proposal not found" });
    }
    return this.respond(response, 404, { error: "Not found" });
  }

  private body(request: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let text = "";
      request.on("data", (chunk: Buffer) => {
        text += chunk.toString("utf8");
        if (text.length > 1_000_000) reject(new Error("Request body too large"));
      });
      request.on("end", () => {
        try { resolve(text ? JSON.parse(text) as Record<string, unknown> : {}); }
        catch { reject(new Error("Request body must be valid JSON")); }
      });
      request.on("error", reject);
    });
  }

  private respond(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  }
}
