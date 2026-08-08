import { Contract, FetchRequest, JsonRpcProvider, Wallet, TypedDataEncoder, getAddress, zeroPadValue } from "ethers";
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
export class EthersSettlementExecutor implements SettlementExecutor {
  private readonly signer:Wallet; private readonly escrow:Contract; private readonly minter:Contract;
  public constructor(rpc:string,key:string,cfg:{contractAddress:string;gatewayMinterAddress:string}) { const request=new FetchRequest(rpc); request.timeout=30_000; const p=new JsonRpcProvider(request,{name:"arc-testnet",chainId:5_042_002},{staticNetwork:true}); this.signer=new Wallet(key,p); this.escrow=new Contract(cfg.contractAddress,["function authorizeBurnIntent(uint256,uint256,uint256,bytes32) returns (bytes32)"],this.signer); this.minter=new Contract(cfg.gatewayMinterAddress,["function gatewayMint(bytes,bytes)"],this.signer); }
  public async authorize(input:BurnIntentAuthorization):Promise<BurnIntentAuthorizationResult>{ const tx=await this.escrow.authorizeBurnIntent(input.settlementIndex,input.maxBlockHeight,input.maxFee,input.salt); const receipt=await tx.wait(); return {burnIntentHash:burnIntentHash(input.burnIntentRequest),authorizationTxHash:receipt.hash}; }
  public async mint(input:{attestation:string;signature:string}):Promise<{mintTxHash:string}>{ const tx=await this.minter.gatewayMint(input.attestation,input.signature); const receipt=await tx.wait(); return {mintTxHash:receipt.hash}; }
}
