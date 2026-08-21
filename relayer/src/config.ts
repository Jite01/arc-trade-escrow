import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Interface, isAddress, type InterfaceAbi } from "ethers";

export interface RelayerConfig {
  contractAddress: string;
  contractAbi: Interface;
  factoryAddress: string;
  resolutionRouterAddress: string;
  factoryAbi: Interface;
  factoryEventTopic: string;
  factoryDeploymentBlock: number;
  eventTopics: Record<"MilestoneReleased" | "MilestoneArbitrated" | "ArbitrationForced" | "FundsReclaimed", string>;
  onchainEventTopics: Record<"ContractCommitted" | "ContractActivated" | "ContractFinalized" | "CommitmentAbandoned", string>;
  commercialRegistryUrl?: string;
  commercialRegistryToken?: string;
  gatewayWalletAddress: string;
  gatewayMinterAddress: string;
  deploymentBlock: number;
  arcRpcUrl: string;
  arcWssUrl?: string;
  gatewayApiBaseUrl: string;
  relayerPrivateKey: string;
  relayerPort: number;
  sqlitePath: string;
  confirmationDepth: number;
  reorgLookbackBlocks: number;
  coordinationMode: "shared-sqlite" | "distributed";
  instanceId: string;
}

const required = ["ARC_RPC_URL"] as const;

interface DeploymentConfig {
  CONTRACT_ADDRESS: string;
  CONTRACT_ABI: InterfaceAbi;
  FACTORY_ADDRESS: string;
  RESOLUTION_ROUTER_ADDRESS: string;
  FACTORY_ABI: InterfaceAbi;
  FACTORY_EVENT_TOPIC_CREATED: string;
  FACTORY_DEPLOYMENT_BLOCK: number;
  EVENT_TOPIC_RELEASED: string;
  EVENT_TOPIC_ARBITRATED: string;
  EVENT_TOPIC_FORCED: string;
  EVENT_TOPIC_RECLAIMED: string;
  GATEWAY_WALLET_ADDRESS: string;
  GATEWAY_MINTER_ADDRESS: string;
  DEPLOYMENT_BLOCK: number;
}

function value(env: NodeJS.ProcessEnv, key: string): string {
  return requiredString(env[key], key);
}

function requiredString(raw: unknown, key: string): string {
  const candidate = typeof raw === "string" ? raw.trim() : "";
  if (!candidate) throw new Error(`Missing required configuration value: ${key}`);
  return candidate;
}

function addressValue(raw: unknown, key: string): string {
  const candidate = requiredString(raw, key);
  if (!isAddress(candidate)) throw new Error(`Invalid address in ${key}`);
  return candidate;
}

function topicValue(raw: unknown, key: string): string {
  const candidate = requiredString(raw, key);
  if (!/^0x[0-9a-fA-F]{64}$/.test(candidate)) throw new Error(`Invalid event topic in ${key}`);
  return candidate;
}

function positiveInteger(raw: string, name: string): number {
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid integer in ${name}`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid integer in ${name}`);
  return parsed;
}

function deploymentBlockValue(raw: unknown): number {
  const candidate = typeof raw === "number" ? String(raw) : requiredString(raw, "DEPLOYMENT_BLOCK");
  return positiveInteger(candidate, "DEPLOYMENT_BLOCK");
}

function readDeploymentConfig(): DeploymentConfig {
  const configPath = resolve(process.cwd(), "config.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Unable to read generated deployment config at ${configPath}${detail}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Generated deployment config at ${configPath} must be a JSON object`);
  }
  const raw = parsed as Record<string, unknown>;
  const abi = raw.CONTRACT_ABI;
  if (!Array.isArray(abi)) throw new Error("Generated deployment config CONTRACT_ABI must be a JSON array");
  const factoryAbi = raw.FACTORY_ABI;
  if (!Array.isArray(factoryAbi)) throw new Error("Generated deployment config FACTORY_ABI must be a JSON array");
  return {
    CONTRACT_ADDRESS: addressValue(raw.CONTRACT_ADDRESS, "CONTRACT_ADDRESS"),
    CONTRACT_ABI: abi as InterfaceAbi,
    FACTORY_ADDRESS: addressValue(raw.FACTORY_ADDRESS, "FACTORY_ADDRESS"),
    RESOLUTION_ROUTER_ADDRESS: addressValue(raw.RESOLUTION_ROUTER_ADDRESS, "RESOLUTION_ROUTER_ADDRESS"),
    FACTORY_ABI: factoryAbi as InterfaceAbi,
    FACTORY_EVENT_TOPIC_CREATED: topicValue(raw.FACTORY_EVENT_TOPIC_CREATED, "FACTORY_EVENT_TOPIC_CREATED"),
    FACTORY_DEPLOYMENT_BLOCK: deploymentBlockValue(raw.FACTORY_DEPLOYMENT_BLOCK),
    EVENT_TOPIC_RELEASED: topicValue(raw.EVENT_TOPIC_RELEASED, "EVENT_TOPIC_RELEASED"),
    EVENT_TOPIC_ARBITRATED: topicValue(raw.EVENT_TOPIC_ARBITRATED, "EVENT_TOPIC_ARBITRATED"),
    EVENT_TOPIC_FORCED: topicValue(raw.EVENT_TOPIC_FORCED, "EVENT_TOPIC_FORCED"),
    EVENT_TOPIC_RECLAIMED: topicValue(raw.EVENT_TOPIC_RECLAIMED, "EVENT_TOPIC_RECLAIMED"),
    GATEWAY_WALLET_ADDRESS: addressValue(raw.GATEWAY_WALLET_ADDRESS, "GATEWAY_WALLET_ADDRESS"),
    GATEWAY_MINTER_ADDRESS: addressValue(raw.GATEWAY_MINTER_ADDRESS, "GATEWAY_MINTER_ADDRESS"),
    DEPLOYMENT_BLOCK: deploymentBlockValue(raw.DEPLOYMENT_BLOCK)
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayerConfig {
  const deployment = readDeploymentConfig();
  for (const key of required) value(env, key);
  const parsedAbi = deployment.CONTRACT_ABI;
  const configuredFactory = env.FACTORY_ADDRESS?.trim();
  if (configuredFactory && configuredFactory.toLowerCase() !== deployment.FACTORY_ADDRESS.toLowerCase()) {
    throw new Error(`FACTORY_ADDRESS does not match generated deployment config: expected ${deployment.FACTORY_ADDRESS}, got ${configuredFactory}`);
  }
  const configuredRouter = env.RESOLUTION_ROUTER_ADDRESS?.trim();
  if (configuredRouter && configuredRouter.toLowerCase() !== deployment.RESOLUTION_ROUTER_ADDRESS.toLowerCase()) {
    throw new Error(`RESOLUTION_ROUTER_ADDRESS does not match generated deployment config: expected ${deployment.RESOLUTION_ROUTER_ADDRESS}, got ${configuredRouter}`);
  }

  const port = positiveInteger(env.PORT?.trim() || env.RELAYER_PORT?.trim() || "3001", "PORT/RELAYER_PORT");
  if (port === 0 || port > 65_535) throw new Error("RELAYER_PORT must be between 1 and 65535");
  const gatewayApiBaseUrl = (env.GATEWAY_API_BASE_URL?.trim() || "https://gateway-api-testnet.circle.com").replace(/\/+$/, "");
  const relayerPrivateKey = env.RELAYER_PRIVATE_KEY?.trim() || env.OPERATOR_PRIVATE_KEY?.trim();
  if (!relayerPrivateKey) throw new Error("Missing required configuration value: RELAYER_PRIVATE_KEY or OPERATOR_PRIVATE_KEY");
  const arcRpcUrl = value(env, "ARC_RPC_URL");
  const confirmationDepth = positiveInteger(env.CONFIRMATION_DEPTH?.trim() || "12", "CONFIRMATION_DEPTH");
  const reorgLookbackBlocks = positiveInteger(env.REORG_LOOKBACK_BLOCKS?.trim() || String(Math.max(24, confirmationDepth * 4)), "REORG_LOOKBACK_BLOCKS");
  const coordinationMode = env.RELAYER_COORDINATION_MODE?.trim() === "distributed" ? "distributed" : "shared-sqlite";
  const instanceId = env.RELAYER_INSTANCE_ID?.trim() || "";
  if (coordinationMode === "distributed" && (!env.COMMERCIAL_REGISTRY_URL?.trim() || !env.COMMERCIAL_REGISTRY_INTERNAL_TOKEN?.trim() || !instanceId)) {
    throw new Error("Distributed relayer coordination requires COMMERCIAL_REGISTRY_URL, COMMERCIAL_REGISTRY_INTERNAL_TOKEN, and RELAYER_INSTANCE_ID");
  }
  const arcWssUrl = env.ARC_WSS_URL?.trim() || undefined;
  try {
    new URL(gatewayApiBaseUrl);
    new URL(arcRpcUrl);
    if (arcWssUrl) new URL(arcWssUrl);
  } catch {
    throw new Error("ARC_RPC_URL, ARC_WSS_URL, and GATEWAY_API_BASE_URL must be valid URLs");
  }
  if (arcWssUrl) console.warn("ARC_WSS_URL is configured but the relayer uses HTTP eth_getLogs polling for resilient event delivery");
  else console.warn("ARC_WSS_URL is not configured; using HTTP eth_getLogs polling for live events");

  return {
    contractAddress: deployment.CONTRACT_ADDRESS,
    contractAbi: new Interface(parsedAbi),
    factoryAddress: deployment.FACTORY_ADDRESS,
    resolutionRouterAddress: deployment.RESOLUTION_ROUTER_ADDRESS,
    factoryAbi: new Interface(deployment.FACTORY_ABI),
    factoryEventTopic: deployment.FACTORY_EVENT_TOPIC_CREATED,
    factoryDeploymentBlock: deployment.FACTORY_DEPLOYMENT_BLOCK,
    eventTopics: {
      MilestoneReleased: deployment.EVENT_TOPIC_RELEASED,
      MilestoneArbitrated: deployment.EVENT_TOPIC_ARBITRATED,
      ArbitrationForced: deployment.EVENT_TOPIC_FORCED,
      FundsReclaimed: deployment.EVENT_TOPIC_RECLAIMED
    },
    onchainEventTopics: Object.fromEntries(([["ContractCommitted", "ContractCommitted"], ["ContractActivated", "ContractActivated"], ["ContractFinalized", "ContractFinalized"], ["CommitmentAbandoned", "CommitmentAbandoned"]] as const).map(([name, abiName]) => [name, new Interface(deployment.CONTRACT_ABI).getEvent(abiName)!.topicHash])) as RelayerConfig["onchainEventTopics"],
    gatewayWalletAddress: deployment.GATEWAY_WALLET_ADDRESS,
    gatewayMinterAddress: deployment.GATEWAY_MINTER_ADDRESS,
    deploymentBlock: deployment.DEPLOYMENT_BLOCK,
    arcRpcUrl,
    arcWssUrl,
    gatewayApiBaseUrl,
    relayerPrivateKey,
    relayerPort: port,
    sqlitePath: env.SQLITE_PATH?.trim() || (env.RAILWAY_VOLUME_MOUNT_PATH?.trim() ? join(env.RAILWAY_VOLUME_MOUNT_PATH.trim(), "relayer.db") : "./relayer.db"),
    confirmationDepth,
    reorgLookbackBlocks,
    coordinationMode,
    instanceId,
    commercialRegistryUrl: env.COMMERCIAL_REGISTRY_URL?.trim().replace(/\/$/, "") || undefined,
    commercialRegistryToken: env.COMMERCIAL_REGISTRY_INTERNAL_TOKEN?.trim() || undefined
  };
}
