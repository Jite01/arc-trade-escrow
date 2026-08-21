import { Contract, Interface, JsonRpcProvider, id as keccakId, isAddress } from "ethers";

const FACTORY_ABI = [
  "function createAgreement(bytes32 id,address seller,uint256 total,uint256 negotiationExpiry,uint256 commitmentWindow,uint256 arbitrationTimeout)",
  "function arbitrator() view returns (address)",
  "function operator() view returns (address)",
  "event AgreementCreated(bytes32 indexed id,address indexed escrow,address indexed buyer,address seller,address arbitrator,uint256 createdAt)"
];
const ESCROW_ABI = [
  "function buyerAddress() view returns (address)", "function sellerAddress() view returns (address)",
  "function arbitrationAddress() view returns (address)", "function operatorAddress() view returns (address)",
  "function totalUSDC() view returns (uint256)"
];

export function createDeploymentVerifier() {
  const rpcUrl = process.env.ARC_RPC_URL || process.env.VITE_ARC_RPC_URL;
  const factoryAddress = process.env.FACTORY_ADDRESS || process.env.VITE_FACTORY_ADDRESS;
  const resolutionRouter = process.env.RESOLUTION_ROUTER_ADDRESS || process.env.ROUTER_ADDRESS;
  if (!rpcUrl || !factoryAddress || !isAddress(factoryAddress) || !resolutionRouter || !isAddress(resolutionRouter)) return null;
  const provider = new JsonRpcProvider(rpcUrl);
  const factory = new Interface(FACTORY_ABI);
  return async (agreement: Record<string, any>, txHash: string) => {
    const tx = await provider.getTransaction(txHash);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!tx || !receipt) throw new Error("Deployment transaction is not available on Arc yet");
    if (receipt.status !== 1) throw new Error("Deployment transaction failed on Arc");
    if (!tx.to || tx.to.toLowerCase() !== factoryAddress.toLowerCase()) throw new Error("Deployment transaction was not sent to the platform factory");
    if (tx.from.toLowerCase() !== String(agreement.buyer_address).toLowerCase()) throw new Error(`buyerAddress mismatch: expected ${agreement.buyer_address}, got ${tx.from}`);
    let parsed;
    try { parsed = factory.parseTransaction({ data: tx.data, value: tx.value }); } catch { throw new Error("Deployment transaction does not call the expected factory method"); }
    if (!parsed || parsed.name !== "createAgreement") throw new Error("Deployment transaction does not call createAgreement");
    const [id, seller, total, expiry, commitment, arbitrationTimeout] = parsed.args;
    if (String(id).toLowerCase() !== keccakId(`arc-trade-commercial:${agreement.id}`).toLowerCase()) throw new Error("Deployment agreement identifier does not match the registry agreement");
    if (String(seller).toLowerCase() !== String(agreement.seller_address).toLowerCase()) throw new Error(`sellerAddress mismatch: expected ${agreement.seller_address}, got ${seller}`);
    if (BigInt(total) !== usdcUnits(String(agreement.total_usdc))) throw new Error("totalUSDC mismatch");
    if (Math.abs(Number(expiry) - Math.floor(new Date(agreement.negotiation_expiry).getTime() / 1000)) > 60) throw new Error("negotiationExpiry mismatch");
    if (BigInt(commitment) !== BigInt(agreement.commitment_window_sec)) throw new Error("commitmentWindow mismatch");
    if (BigInt(arbitrationTimeout) !== BigInt(agreement.arbitration_timeout_sec)) throw new Error("arbitrationTimeout mismatch");
    let escrow = "";
    for (const log of receipt.logs) { try { const event = factory.parseLog(log as any); if (event?.name === "AgreementCreated") escrow = String(event.args[1]); } catch {} }
    if (!isAddress(escrow) || /^0x0{40}$/i.test(escrow)) throw new Error("Deployment receipt did not contain an escrow address");
    if (await provider.getCode(escrow) === "0x") throw new Error("Verified escrow address has no bytecode");
    if (await provider.getCode(resolutionRouter) === "0x") throw new Error("Configured Resolution Router has no bytecode");
    const contract = new Contract(escrow, ESCROW_ABI, provider);
    const checks: Array<[string, string, string]> = [
      ["buyerAddress", String(agreement.buyer_address), String(await contract.buyerAddress())],
      ["sellerAddress", String(agreement.seller_address), String(await contract.sellerAddress())],
      ["arbitrationAddress", resolutionRouter, String(await contract.arbitrationAddress())],
      ["operatorAddress", (process.env.PLATFORM_OPERATOR_ADDRESS || process.env.OPERATOR_ADDRESS || "0x0bF9683D68c79976281A6a16CFb9A49608a1a37c").toLowerCase(), String(await contract.operatorAddress())]
    ];
    for (const [field, expected, actual] of checks) if (expected.toLowerCase() !== actual.toLowerCase()) throw new Error(`${field} mismatch: expected ${expected}, got ${actual}`);
    if (BigInt(await contract.totalUSDC()) !== usdcUnits(String(agreement.total_usdc))) throw new Error("on-chain totalUSDC mismatch");
    return { contractAddress: escrow, chainId: 5042002, txHash, blockNumber: Number(receipt.blockNumber) };
  };
}

export async function validateDeploymentConfiguration(): Promise<void> {
  const rpcUrl = process.env.ARC_RPC_URL || process.env.VITE_ARC_RPC_URL;
  const factoryAddress = process.env.FACTORY_ADDRESS || process.env.VITE_FACTORY_ADDRESS;
  const resolutionRouter = process.env.RESOLUTION_ROUTER_ADDRESS || process.env.ROUTER_ADDRESS;
  if (!rpcUrl) throw new Error("Commercial API startup validation failed: ARC_RPC_URL is required");
  if (!factoryAddress || !isAddress(factoryAddress)) throw new Error("Commercial API startup validation failed: FACTORY_ADDRESS is required and must be an address");
  if (!resolutionRouter || !isAddress(resolutionRouter)) throw new Error("Commercial API startup validation failed: RESOLUTION_ROUTER_ADDRESS is required and must be an address");
  const provider = new JsonRpcProvider(rpcUrl);
  const expectedChainId = BigInt(process.env.ARC_CHAIN_ID || "5042002");
  const network = await provider.getNetwork();
  if (network.chainId !== expectedChainId) throw new Error(`Commercial API startup validation failed: expected chain ${expectedChainId}, connected to ${network.chainId}`);
  if ((await provider.getCode(factoryAddress)) === "0x") throw new Error(`Commercial API startup validation failed: no factory code at ${factoryAddress}`);
  if ((await provider.getCode(resolutionRouter)) === "0x") throw new Error(`Commercial API startup validation failed: no Resolution Router code at ${resolutionRouter}`);
  const factory = new Contract(factoryAddress, FACTORY_ABI, provider);
  const actualRouter = String(await factory.arbitrator());
  if (actualRouter.toLowerCase() !== resolutionRouter.toLowerCase()) {
    throw new Error(`Commercial API startup validation failed: factory ${factoryAddress} references ${actualRouter}, expected ${resolutionRouter}`);
  }
}

function usdcUnits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
}
