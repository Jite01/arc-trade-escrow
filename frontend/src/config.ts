import generated from "../config.json";
const rpcUrl = (import.meta.env.VITE_ARC_RPC_URL || "").trim();
if (!rpcUrl) throw new Error("VITE_ARC_RPC_URL is required for contract reads");
const configuredRelayer = (import.meta.env.VITE_RELAYER_BASE_URL || "").trim();
const hostedRelayer = "https://arc-trade-escrow-relayer-production-56a0.up.railway.app";
const localHost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
const stalePublicTunnel = !localHost && /localhost|127\.0\.0\.1|loca\.lt/i.test(configuredRelayer);
const relayerUrl = configuredRelayer && !stalePublicTunnel ? configuredRelayer : (localHost ? "http://localhost:3001" : hostedRelayer);

export const config = {
  factoryAddress: import.meta.env.VITE_FACTORY_ADDRESS || generated.FACTORY_ADDRESS,
  resolutionRouterAddress: import.meta.env.VITE_RESOLUTION_ROUTER_ADDRESS || generated.RESOLUTION_ROUTER_ADDRESS,
  factoryAbi: generated.FACTORY_ABI,
  escrowAbi: import.meta.env.VITE_CONTRACT_ABI ? JSON.parse(import.meta.env.VITE_CONTRACT_ABI) : generated.CONTRACT_ABI,
  rpcUrl,
  relayerUrl: relayerUrl.replace(/\/$/, ""),
  factoryDeploymentBlock: Number(import.meta.env.VITE_FACTORY_DEPLOYMENT_BLOCK || generated.FACTORY_DEPLOYMENT_BLOCK),
  tokenAddress: "0x3600000000000000000000000000000000000000"
};
