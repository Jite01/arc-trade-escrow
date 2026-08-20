import { AbiCoder, Contract, FetchRequest, JsonRpcProvider, Wallet, TypedDataEncoder, getAddress, keccak256, zeroPadValue } from "ethers";
import type { BurnIntentAuthorization, BurnIntentRequest, BurnIntentSpec, BurnIntentAuthorizationResult, SettlementExecutor } from "./types.js";

const types: Record<string, Array<{name:string;type:string}>> = {
  BurnIntent: [{name:"maxBlockHeight",type:"uint256"},{name:"maxFee",type:"uint256"},{name:"spec",type:"TransferSpec"}],
  TransferSpec: ["version","sourceDomain","destinationDomain","sourceContract","destinationContract","sourceToken","destinationToken","sourceDepositor","destinationRecipient","sourceSigner","destinationCaller","value","salt","hookData"].map((name,i)=>({name,type:["uint32","uint32","uint32","bytes32","bytes32","bytes32","bytes32","bytes32","bytes32","bytes32","bytes32","uint256","bytes32","bytes"][i]}))
};
const domain = { name:"GatewayWallet", version:"1" };
const b32=(a:string)=>zeroPadValue(getAddress(a),32);
export function buildBurnIntent(input: BurnIntentAuthorization, cfg:{gatewayWalletAddress:string;gatewayMinterAddress:string;contractAddress:string}):BurnIntentRequest {
  const spec:BurnIntentSpec={version:1,sourceDomain:26,destinationDomain:26,sourceContract:b32(cfg.gatewayWalletAddress),destinationContract:b32(cfg.gatewayMinterAddress),sourceToken:b32("0x3600000000000000000000000000000000000000"),destinationToken:b32("0x3600000000000000000000000000000000000000"),sourceDepositor:b32(cfg.contractAddress),destinationRecipient:b32(input.recipient),sourceSigner:b32(cfg.contractAddress),destinationCaller:"0x"+"00".repeat(32),value:input.amount.toString(),salt:input.salt,hookData:"0x"};
  return {maxBlockHeight:input.maxBlockHeight.toString(),maxFee:input.maxFee.toString(),spec};
}
export function burnIntentHash(req:BurnIntentRequest):string { return TypedDataEncoder.hash(domain,types,{maxBlockHeight:req.maxBlockHeight,maxFee:req.maxFee,spec:req.spec}); }
export function settlementSalt(escrowAddress:string, settlementIndex:bigint):string {
  return keccak256(AbiCoder.defaultAbiCoder().encode(["string","address","uint256"],["ArcTrade/BurnIntent/v1",escrowAddress,settlementIndex]));
}
export class EthersSettlementExecutor implements SettlementExecutor {
  private readonly signer:Wallet; private readonly minter:Contract;
  public constructor(rpc:string,key:string,cfg:{gatewayMinterAddress:string}) { const request=new FetchRequest(rpc); request.timeout=30_000; const p=new JsonRpcProvider(request,{name:"arc-testnet",chainId:5_042_002},{staticNetwork:true}); this.signer=new Wallet(key,p); this.minter=new Contract(cfg.gatewayMinterAddress,["function gatewayMint(bytes,bytes)"],this.signer); }
  public async authorize(input:BurnIntentAuthorization, escrowAddress:string):Promise<BurnIntentAuthorizationResult>{
    const escrow=new Contract(escrowAddress,[
      "function authorizeBurnIntent(uint256,uint256,uint256,bytes32) returns (bytes32)",
      "function getBurnIntentHash(uint256,uint256,uint256,bytes32) view returns (bytes32)",
      "function authorizedTransfers(bytes32) view returns (bool)",
      "function settlementRecorded(uint256) view returns (bool)",
      "function settlementRecipient(uint256) view returns (address)",
      "function settlementAmount(uint256) view returns (uint256)",
      "function milestoneStates(uint256) view returns (uint8)",
      "event BurnIntentAuthorized(bytes32 indexed burnIntentHash,uint256 indexed settlementIndex,address recipient,uint256 amount)"
    ],this.signer);
    const expectedHash=burnIntentHash(input.burnIntentRequest);
    const onchainHash=String(await escrow.getBurnIntentHash(input.settlementIndex,input.maxBlockHeight,input.maxFee,input.salt));
    if (onchainHash.toLowerCase()!==expectedHash.toLowerCase()) throw new Error(`Burn intent hash mismatch for ${escrowAddress}:${input.settlementIndex}`);
    if (!(await escrow.settlementRecorded(input.settlementIndex))) throw new Error(`Settlement is not recorded for ${escrowAddress}:${input.settlementIndex}`);
    const onchainRecipient=getAddress(String(await escrow.settlementRecipient(input.settlementIndex)));
    const onchainAmount=BigInt(await escrow.settlementAmount(input.settlementIndex));
    if (onchainRecipient.toLowerCase()!==getAddress(input.recipient).toLowerCase() || onchainAmount!==input.amount) throw new Error(`Settlement terms changed for ${escrowAddress}:${input.settlementIndex}`);
    if (input.settlementIndex !== 2n**256n-1n) {
      const state=Number(await escrow.milestoneStates(input.settlementIndex));
      const expectedStates=input.eventType==="MilestoneReleased"?[4]:[6];
      if (!expectedStates.includes(state)) throw new Error(`Settlement state ${state} is incompatible with ${input.eventType}`);
    }
    if (await escrow.authorizedTransfers(expectedHash)) return {burnIntentHash:expectedHash,authorizationTxHash:"already-authorized"};
    const tx=await escrow.authorizeBurnIntent(input.settlementIndex,input.maxBlockHeight,input.maxFee,input.salt);
    const receipt=await tx.wait();
    let matched=false;
    for (const log of receipt.logs) {
      if (String(log.address).toLowerCase()!==escrowAddress.toLowerCase()) continue;
      try {
        const parsed=escrow.interface.parseLog({topics:log.topics,data:log.data});
        if (!parsed || parsed.name!=="BurnIntentAuthorized") continue;
        if (String(parsed.args.burnIntentHash).toLowerCase()!==expectedHash.toLowerCase() || BigInt(parsed.args.settlementIndex)!==input.settlementIndex || getAddress(String(parsed.args.recipient)).toLowerCase()!==onchainRecipient.toLowerCase() || BigInt(parsed.args.amount)!==onchainAmount) throw new Error(`Burn intent event mismatch for ${escrowAddress}:${input.settlementIndex}`);
        matched=true;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Burn intent event mismatch")) throw error;
      }
    }
    if (!matched) throw new Error(`Missing BurnIntentAuthorized event for ${escrowAddress}:${input.settlementIndex}`);
    return {burnIntentHash:expectedHash,authorizationTxHash:receipt.hash};
  }
  public async mint(input:{attestation:string;signature:string}):Promise<{mintTxHash:string}>{ const tx=await this.minter.gatewayMint(input.attestation,input.signature); const receipt=await tx.wait(); return {mintTxHash:receipt.hash}; }
}
