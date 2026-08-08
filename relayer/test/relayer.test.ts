import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";
import { Interface } from "ethers";
import { loadConfig, type RelayerConfig } from "../src/config.js";
import { TransferDatabase } from "../src/database.js";
import { CircleGatewayClient } from "../src/gateway.js";
import { Relayer } from "../src/relayer.js";
import type { ChainLog, EventSource, GatewayClient, GatewayResult, Logger, LogProvider, SettlementExecutor } from "../src/types.js";

const escrow="0x1111111111111111111111111111111111111111", recipient="0x2222222222222222222222222222222222222222";
const abi=new Interface(["event MilestoneReleased(uint256 index,address recipient,uint256 amount)","event FundsReclaimed(address recipient,uint256 amount)"]);
const topics={MilestoneReleased:abi.getEvent("MilestoneReleased")!.topicHash,MilestoneArbitrated:abi.getEvent("MilestoneReleased")!.topicHash,ArbitrationForced:abi.getEvent("MilestoneReleased")!.topicHash,FundsReclaimed:abi.getEvent("FundsReclaimed")!.topicHash};
class Provider implements LogProvider { constructor(private logs:ChainLog[]=[]){ } async getBlockNumber(){return 10;} async getCode(){return "0x6000";} async getLogs(){return this.logs;} }
class Source implements EventSource { private fn?: (l:ChainLog)=>void; subscribe(_t:string,fn:(l:ChainLog)=>void){this.fn=fn;} unsubscribe(){} emit(l:ChainLog){this.fn?.(l);} }
class Log implements Logger { debug(){} info(){} warn(){} error(){} }
class Gateway implements GatewayClient { requests:any[]=[]; async submit(r:any):Promise<GatewayResult>{this.requests.push(r);return {status:200,body:{id:"t1",attestation:{payload:"0xabc",signature:"0xsig"}}};} }
class Executor implements SettlementExecutor { auths:any[]=[]; mints:any[]=[]; async authorize(i:any){this.auths.push(i);return {burnIntentHash:"0x"+"aa".repeat(32),authorizationTxHash:"0x"+"bb".repeat(32)};} async mint(i:any){this.mints.push(i);return {mintTxHash:"0x"+"cc".repeat(32)};} }
function cfg():RelayerConfig{return {contractAddress:escrow,contractAbi:abi,eventTopics:topics,gatewayWalletAddress:"0x3333333333333333333333333333333333333333",gatewayMinterAddress:"0x4444444444444444444444444444444444444444",deploymentBlock:1,arcRpcUrl:"http://localhost:1",gatewayApiBaseUrl:"http://localhost:1",relayerPrivateKey:"0x"+"11".repeat(32),relayerPort:0,sqlitePath:":memory:"};}
function log():ChainLog {const e=abi.encodeEventLog(abi.getEvent("MilestoneReleased")!,[0,recipient,1000000]);return {topics:e.topics,data:e.data,transactionHash:"0x"+"dd".repeat(32),blockNumber:2,logIndex:0};}
test("config loads deployment metadata from the generated manifest",()=>{const c={CONTRACT_ADDRESS:"not-used",CONTRACT_ABI:"not-used",EVENT_TOPIC_RELEASED:"not-used",EVENT_TOPIC_ARBITRATED:"not-used",EVENT_TOPIC_FORCED:"not-used",EVENT_TOPIC_RECLAIMED:"not-used",GATEWAY_WALLET_ADDRESS:"not-used",GATEWAY_MINTER_ADDRESS:"not-used",DEPLOYMENT_BLOCK:"not-used",ARC_RPC_URL:"http://localhost:1",GATEWAY_API_BASE_URL:"https://gateway-api-testnet.circle.com",RELAYER_PRIVATE_KEY:cfg().relayerPrivateKey};const generated=JSON.parse(readFileSync("config.json","utf8"));const loaded=loadConfig(c);assert.equal(loaded.contractAddress,generated.CONTRACT_ADDRESS);assert.equal(loaded.deploymentBlock,generated.DEPLOYMENT_BLOCK);assert.equal(loaded.gatewayMinterAddress,generated.GATEWAY_MINTER_ADDRESS);assert.throws(()=>loadConfig({...c,RELAYER_PRIVATE_KEY:""}),/RELAYER_PRIVATE_KEY/);});
test("fund event authorizes, submits, and mints one settlement",async()=>{const db=new TransferDatabase(":memory:"),g=new Gateway(),e=new Executor(),r=new Relayer(cfg(),db,new Provider([log()]),new Source(),g,e,new Log(),()=>100);await r.initialize();const row=db.all()[0]!;assert.equal(row.status,"MINTED");assert.equal(e.auths.length,1);assert.equal(g.requests[0].signature,"0x00");assert.equal(g.requests[0].contractSigner,true);assert.equal(e.mints[0].attestation,"0xabc");r.stop();db.close();});
test("Gateway client sends an unauthenticated array request",async()=>{let seen:any;const server=createServer((req,res)=>{seen={headers:req.headers,method:req.method,url:req.url};let body="";req.on("data",c=>body+=c);req.on("end",()=>{seen.body=JSON.parse(body);res.writeHead(200,{"content-type":"application/json"});res.end("{}");});}).listen(0);await new Promise<void>(resolve=>server.once("listening",()=>resolve()));const port=(server.address() as any).port;const c=new CircleGatewayClient(`http://127.0.0.1:${port}`);await c.submit({burnIntent:{maxBlockHeight:"1",maxFee:"0",spec:{} as any},signature:"0x",contractSigner:true});assert.equal(seen.method,"POST");assert.equal(seen.headers.authorization,undefined);assert.equal(Array.isArray(seen.body),true);server.close();});
