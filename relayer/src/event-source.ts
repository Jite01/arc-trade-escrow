import { Contract, WebSocketProvider, type JsonRpcProvider, type Log } from "ethers";
import type { RelayerConfig } from "./config.js";
import type { ChainLog, EventSource, LogProvider } from "./types.js";

export class EthersLogProvider implements LogProvider {
  public constructor(private readonly provider: JsonRpcProvider) {}

  public getBlockNumber(): Promise<number> { return this.provider.getBlockNumber(); }
  public getCode(address: string): Promise<string> { return this.provider.getCode(address); }
  public async getAvailableBalance(token: string, depositor: string): Promise<bigint> {
    const wallet = new Contract("0x0077777d7EBA4688BDeF3E311b846F25870A19B9", ["function availableBalance(address token,address depositor) view returns (uint256)"], this.provider);
    return BigInt(await wallet.availableBalance(token, depositor));
  }
  public async getLogs(filter: { address: string; fromBlock: number; toBlock: number; topics: readonly (readonly string[])[] }): Promise<ChainLog[]> {
    const logs = await this.provider.getLogs({ address: filter.address, fromBlock: filter.fromBlock, toBlock: filter.toBlock, topics: filter.topics as string[][] });
    return logs.map((log) => ({ topics: log.topics, data: log.data, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.index, removed: log.removed }));
  }
}

type SubscriptionProvider = JsonRpcProvider | WebSocketProvider;

export class EthersContractEventSource implements EventSource {
  private contract: Contract;
  private readonly listeners = new Map<string, { eventName: string; listener: (log: ChainLog) => void }>();
  private stopped = false;
  private reconnecting = false;

  public constructor(private provider: SubscriptionProvider, private readonly config: RelayerConfig) {
    this.contract = this.createContract(provider);
    this.attachReconnectHandler();
  }

  public subscribe(topic: string, listener: (log: ChainLog) => void): void {
    const event = this.contract.interface.fragments
      .filter((fragment): fragment is import("ethers").EventFragment => fragment.type === "event")
      .find((fragment) => fragment.topicHash.toLowerCase() === topic.toLowerCase());
    if (!event) throw new Error(`Contract ABI does not define event for topic ${topic}`);
    const key = topic.toLowerCase();
    this.listeners.set(key, { eventName: event.name, listener });
    this.contract.on(event.name, this.makeContractListener(key));
  }

  public unsubscribe(): void {
    this.stopped = true;
    this.listeners.clear();
    this.contract.removeAllListeners();
    if (this.provider instanceof WebSocketProvider) void this.provider.destroy();
  }

  private createContract(provider: SubscriptionProvider): Contract {
    return new Contract(this.config.contractAddress, this.config.contractAbi, provider);
  }

  private makeContractListener(topic: string): (...args: unknown[]) => void {
    return (...args: unknown[]) => {
      const log = args.at(-1) as (Log & { removed?: boolean }) | undefined;
      if (!log?.topics || !log.data || !log.transactionHash) return;
      this.listeners.get(topic)?.listener({ topics: log.topics, data: log.data, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.index, removed: log.removed });
    };
  }

  private attachReconnectHandler(): void {
    if (!(this.provider instanceof WebSocketProvider)) return;
    const socket = this.provider.websocket as typeof this.provider.websocket & { onclose?: () => void };
    socket.onclose = () => {
      if (this.stopped || this.reconnecting || !this.config.arcWssUrl) return;
      this.reconnecting = true;
      console.error("WebSocket disconnected — reconnecting...");
      try {
        this.provider = new WebSocketProvider(this.config.arcWssUrl);
        this.contract = this.createContract(this.provider);
        for (const [topic, subscription] of this.listeners) this.contract.on(subscription.eventName, this.makeContractListener(topic));
        this.attachReconnectHandler();
      } finally {
        this.reconnecting = false;
      }
    };
  }
}
