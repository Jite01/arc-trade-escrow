import generated from "../config.json";
const rpcUrl = (import.meta.env.VITE_ARC_RPC_URL || "").trim();
if (!rpcUrl) throw new Error("VITE_ARC_RPC_URL is required for contract reads");

export const config = {
  factoryAddress: import.meta.env.VITE_FACTORY_ADDRESS || generated.FACTORY_ADDRESS,
  factoryAbi: generated.FACTORY_ABI,
  escrowAbi: import.meta.env.VITE_CONTRACT_ABI ? JSON.parse(import.meta.env.VITE_CONTRACT_ABI) : generated.CONTRACT_ABI,
  rpcUrl,
  relayerUrl: (import.meta.env.VITE_RELAYER_BASE_URL || "http://localhost:3001").replace(/\/$/, ""),
  factoryDeploymentBlock: Number(import.meta.env.VITE_FACTORY_DEPLOYMENT_BLOCK || generated.FACTORY_DEPLOYMENT_BLOCK),
  tokenAddress: "0x3600000000000000000000000000000000000000"
};
