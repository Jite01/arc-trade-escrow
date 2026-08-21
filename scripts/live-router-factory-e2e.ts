import { Contract, FetchRequest, JsonRpcProvider, Wallet, getAddress, keccak256, toUtf8Bytes } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";

type AnyRecord = Record<string, any>;
const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const generated = JSON.parse(readFileSync("config.json", "utf8")) as AnyRecord;
const rpcRequest = new FetchRequest(required("ARC_RPC_URL"));
rpcRequest.timeout = 30_000;
const provider = new JsonRpcProvider(rpcRequest, { name: "arc-testnet", chainId: 5_042_002 }, { staticNetwork: true });
const factoryAddress = getAddress(process.env.FACTORY_ADDRESS || generated.FACTORY_ADDRESS);
const routerAddress = getAddress(required("RESOLUTION_ROUTER_ADDRESS"));
const usdcAddress = getAddress(process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000");
const buyer = new Wallet(required("BUYER_PRIVATE_KEY"), provider);
const seller = new Wallet(required("SELLER_PRIVATE_KEY"), provider);
const resolver = new Wallet(required("ARBITRATION_PRIVATE_KEY"), provider);
const totalUSDC = BigInt(process.env.LIVE_E2E_TOTAL_USDC || "2500000");
const relayerStatusUrl = (process.env.RELAYER_STATUS_URL || "http://localhost:3001").replace(/\/+$/, "");
const factory = new Contract(factoryAddress, generated.FACTORY_ABI, buyer);
const escrowAbi = generated.CONTRACT_ABI;
const escrowInterface = new Contract(factoryAddress, generated.FACTORY_ABI, provider).interface;
const escrowRouter = new Contract(routerAddress, [
  "function getCaseId(address escrow,uint256 milestoneIndex) view returns (bytes32)",
  "function resolve((address escrow,uint256 milestoneIndex,address resolver,uint256 assignmentNonce,uint256 assignmentExpiry,address recipient,uint256 decisionNonce,uint256 decisionExpiry,bytes buyerSignature,bytes sellerSignature,bytes resolverAssignmentSignature,bytes resolverDecisionSignature))"
], resolver);
const usdc = new Contract(usdcAddress, ["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"], buyer);
const gatewayWallet = new Contract(process.env.GATEWAY_WALLET_ADDRESS || "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", [
  "function totalBalance(address,address) view returns (uint256)",
  "function availableBalance(address,address) view returns (uint256)"
], provider);
const transactions: AnyRecord[] = [];

async function send(label: string, transaction: Promise<any>): Promise<any> {
  const tx = await transaction;
  const receipt = await tx.wait();
  const item = { label, hash: tx.hash, blockNumber: receipt.blockNumber, status: receipt.status };
  transactions.push(item);
  console.log(`${label}_TX=${tx.hash}`);
  console.log(`${label}_BLOCK=${receipt.blockNumber}`);
  return receipt;
}

async function readBalances(escrowAddress: string): Promise<AnyRecord> {
  return {
    buyerUSDC: String(await usdc.balanceOf(await buyer.getAddress())),
    sellerUSDC: String(await new Contract(usdcAddress, ["function balanceOf(address) view returns (uint256)"], provider).balanceOf(await seller.getAddress())),
    gatewayTotal: String(await gatewayWallet.totalBalance(usdcAddress, escrowAddress)),
    gatewayAvailable: String(await gatewayWallet.availableBalance(usdcAddress, escrowAddress))
  };
}

async function getRelayerTransfer(logicalKey: string): Promise<AnyRecord | null> {
  const response = await fetch(`${relayerStatusUrl}/transfers`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Relayer status returned HTTP ${response.status}`);
  const rows = await response.json() as AnyRecord[];
  return rows.find(row => row.logicalSettlementKey === logicalKey) || null;
}

async function waitForRelayer(logicalKey: string): Promise<AnyRecord> {
  for (let attempt = 0; attempt < 60; ++attempt) {
    const row = await getRelayerTransfer(logicalKey);
    if (row && ["MINTED", "FAILED", "PERMANENT_FAILURE", "RECONCILIATION_REQUIRED"].includes(row.status)) return row;
    await new Promise(resolve => setTimeout(resolve, 5_000));
  }
  throw new Error(`Relayer did not finalize ${logicalKey} within the test window`);
}

async function main(): Promise<void> {
  const chainId = BigInt((await provider.getNetwork()).chainId);
  if (chainId !== 5_042_002n) throw new Error(`Expected Arc Testnet, got ${chainId}`);
  if (getAddress(await factory.arbitrator()) !== routerAddress) throw new Error("Configured factory does not reference the expected Resolution Router");

  const buyerAddress = getAddress(await buyer.getAddress());
  const sellerAddress = getAddress(await seller.getAddress());
  const resolverAddress = getAddress(await resolver.getAddress());
  const existingEscrow = process.env.LIVE_E2E_ESCROW_ADDRESS?.trim() ? getAddress(process.env.LIVE_E2E_ESCROW_ADDRESS) : null;
  const agreementId = process.env.LIVE_E2E_AGREEMENT_ID || keccak256(toUtf8Bytes(`arc-trade-live-router-e2e:${Date.now()}`));
  const now = Math.floor(Date.now() / 1000);
  const negotiationExpiry = BigInt(now + 3_600);
  const arbitrationTimeout = 600n;
  const result: AnyRecord = {
    chainId: chainId.toString(),
    factoryAddress,
    routerAddress,
    deployer: null,
    agreementId: existingEscrow ? null : agreementId,
    resolutionPolicy: "ARCTRADE_DEFAULT",
    buyerAddress,
    sellerAddress,
    resolverAddress,
    totalUSDC: totalUSDC.toString(),
    transactions,
    balancesBefore: null,
    balancesAfter: null
  };

  const beforeFactory = await provider.getBlockNumber();
  result.factoryDeploymentBlock = Number(generated.FACTORY_DEPLOYMENT_BLOCK);
  result.testStartBlock = beforeFactory;
  result.balancesBefore = await readBalances("0x0000000000000000000000000000000000000000");

  let escrowAddress = existingEscrow || "";
  if (!existingEscrow) {
    const agreementReceipt = await send("CREATE_AGREEMENT", factory.createAgreement(agreementId, sellerAddress, totalUSDC, negotiationExpiry, 1, arbitrationTimeout));
    result.deploymentTxHash = transactions.at(-1)?.hash;
    result.deploymentBlock = agreementReceipt.blockNumber;
    for (const log of agreementReceipt.logs) {
      try {
        const parsed = escrowInterface.parseLog(log);
        if (parsed?.name === "AgreementCreated") escrowAddress = getAddress(String(parsed.args[1]));
      } catch { /* unrelated log */ }
    }
    if (!escrowAddress) throw new Error("Factory receipt did not contain AgreementCreated");
  }
  result.escrowAddress = escrowAddress;

  const escrow = new Contract(escrowAddress, escrowAbi, buyer);
  if (!existingEscrow) {
    const agreement = await factory.getAgreement(agreementId);
    if (getAddress(String(agreement.arbitrator)) !== routerAddress) throw new Error("Created escrow arbitrator does not match the Resolution Router");
  }
  if (getAddress(await escrow.arbitrationAddress()) !== routerAddress) throw new Error("Created escrow arbitrationAddress does not match the Resolution Router");

  if (!existingEscrow) {
    await send("PROPOSE_MILESTONES", escrow.proposeMilestones([{ description: "Router-backed live E2E milestone", basisPoints: 10_000, sellerDeadline: 3_600, buyerResponseWindow: 300, disputeWindow: 300 }]));
    await send("BUYER_APPROVE", escrow.approve());
    await send("SELLER_APPROVE", escrow.connect(seller).approve());
    await send("USDC_APPROVE", usdc.approve(escrowAddress, totalUSDC));
    await send("DEPOSIT", escrow.depositUSDS());
  }
  result.afterFunding = { state: Number(await escrow.getState()), balances: await escrow.getBalances() };
  if (!existingEscrow && result.afterFunding.state !== 2) throw new Error("Escrow did not enter ACTIVE after funding");

  if (!existingEscrow) {
    await send("TRIGGER", escrow.connect(seller).triggerMilestone(0, keccak256(toUtf8Bytes(`router-live-proof:${agreementId}`))));
    await send("DISPUTE", escrow.dispute(0));
  }
  const currentMilestoneState = Number((await escrow.getMilestoneStatus(0))[0]);
  result.afterDispute = { state: currentMilestoneState, caseId: String(await escrowRouter.getCaseId(escrowAddress, 0)) };
  if (currentMilestoneState !== 5 && currentMilestoneState !== 6) throw new Error("Milestone is neither DISPUTED nor ARBITRATED");

  const caseId = result.afterDispute.caseId;
  const assignmentExpiry = BigInt(Math.floor(Date.now() / 1000) + 3_600);
  const decisionExpiry = BigInt(Math.floor(Date.now() / 1000) + 1_800);
  const assignment = { caseId, escrow: escrowAddress, milestoneIndex: 0n, buyer: buyerAddress, seller: sellerAddress, resolver: resolverAddress, assignmentNonce: 1n, assignmentExpiry };
  const decision = { caseId, escrow: escrowAddress, milestoneIndex: 0n, resolver: resolverAddress, recipient: sellerAddress, decisionNonce: 1n, decisionExpiry, assignmentNonce: 1n, assignmentExpiry };
  const domain = { name: "ArcTrade Resolution Router", version: "1", chainId, verifyingContract: routerAddress };
  const assignmentTypes = { ResolutionAssignment: [
    { name: "caseId", type: "bytes32" }, { name: "escrow", type: "address" }, { name: "milestoneIndex", type: "uint256" },
    { name: "buyer", type: "address" }, { name: "seller", type: "address" }, { name: "resolver", type: "address" },
    { name: "assignmentNonce", type: "uint256" }, { name: "assignmentExpiry", type: "uint256" }
  ] };
  const decisionTypes = { ResolutionDecision: [
    { name: "caseId", type: "bytes32" }, { name: "escrow", type: "address" }, { name: "milestoneIndex", type: "uint256" },
    { name: "resolver", type: "address" }, { name: "recipient", type: "address" }, { name: "decisionNonce", type: "uint256" },
    { name: "decisionExpiry", type: "uint256" }, { name: "assignmentNonce", type: "uint256" }, { name: "assignmentExpiry", type: "uint256" }
  ] };
  const signatures = {
    buyerSignature: await buyer.signTypedData(domain, assignmentTypes, assignment),
    sellerSignature: await seller.signTypedData(domain, assignmentTypes, assignment),
    resolverAssignmentSignature: await resolver.signTypedData(domain, assignmentTypes, assignment),
    resolverDecisionSignature: await resolver.signTypedData(domain, decisionTypes, decision)
  };
  if (currentMilestoneState === 5) {
    await send("ROUTER_RESOLVE", escrowRouter.resolve({
      escrow: escrowAddress,
      milestoneIndex: 0n,
      resolver: resolverAddress,
      assignmentNonce: 1n,
      assignmentExpiry,
      recipient: sellerAddress,
      decisionNonce: 1n,
      decisionExpiry,
      ...signatures
    }));
  }
  const milestone = await escrow.getMilestoneStatus(0);
  result.afterResolution = { milestoneState: Number(milestone[0]), settlementRecorded: await escrow.settlementRecorded(0), recipient: getAddress(await escrow.settlementRecipient(0)), amount: String(await escrow.settlementAmount(0)) };
  if (!result.afterResolution.settlementRecorded || result.afterResolution.recipient !== sellerAddress || result.afterResolution.amount !== totalUSDC.toString()) throw new Error("Escrow settlement record does not match the router decision");

  const transfer = await waitForRelayer(`${escrowAddress.toLowerCase()}:0`);
  result.relayerSettlement = transfer;
  result.balancesAfter = await readBalances(escrowAddress);
  result.finalMilestone = { state: Number((await escrow.getMilestoneStatus(0))[0]), balances: await escrow.getBalances() };
  result.completed = transfer.status === "MINTED" && result.finalMilestone.state === 6;
  const outputPath = process.env.LIVE_E2E_OUTPUT || `/tmp/arc-trade-router-e2e-${Date.now()}.json`;
  const replacer = (_key: string, value: unknown) => typeof value === "bigint" ? value.toString() : value;
  writeFileSync(outputPath, JSON.stringify(result, replacer, 2) + "\n");
  console.log(JSON.stringify({ ...result, outputPath }, replacer, 2));
  if (!result.completed) throw new Error(`E2E did not finalize successfully: ${transfer.status}`);
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), transactions }, null, 2));
  process.exitCode = 1;
});
