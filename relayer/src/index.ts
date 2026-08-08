import { JsonRpcProvider } from "ethers";
import { loadConfig } from "./config.js";
import { TransferDatabase } from "./database.js";
import { EthersContractEventSource, EthersLogProvider } from "./event-source.js";
import { CircleGatewayClient } from "./gateway.js";
import { consoleLogger } from "./logger.js";
import { Relayer } from "./relayer.js";
import { StatusServer } from "./status-server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const provider = new JsonRpcProvider(config.arcRpcUrl);
  const database = new TransferDatabase(config.sqlitePath);
  const relayer = new Relayer(
    config,
    database,
    new EthersLogProvider(provider),
    new EthersContractEventSource(provider, config),
    new CircleGatewayClient(config.gatewayApiBaseUrl, config.gatewayApiKey),
    consoleLogger
  );
  const server = new StatusServer(relayer, config.relayerPort);
  await relayer.initialize();
  await server.start();
  consoleLogger.info("Relayer status server started", { port: config.relayerPort });

  const shutdown = async (): Promise<void> => {
    relayer.stop();
    await server.stop();
    database.close();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
}

void main().catch((error) => {
  consoleLogger.error("Relayer startup failed", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
