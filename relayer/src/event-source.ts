import { Contract, type JsonRpcProvider } from "ethers";
import type { RelayerConfig } from "./config.js";
import type { ChainLog, EventSource, LogProvider } from "./types.js";

export class EthersLogProvider implements LogProvider {
  public constructor(private readonly provider: JsonRpcProvider) {}

  public getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  public getCode(address: string): Promise<string> {
    return this.provider.getCode(address);
  }

  public async getLogs(filter: { address: string; fromBlock: number; toBlock: number; topics: readonly (readonly string[])[] }): Promise<ChainLog[]> {
    const logs = await this.provider.getLogs({
      address: filter.address,
      fromBlock: filter.fromBlock,
      toBlock: filter.toBlock,
      topics: filter.topics as string[][]
    });
    return logs.map((log) => ({
      topics: log.topics,
      data: log.data,
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
      removed: log.removed
    }));
  }
}

export class EthersContractEventSource implements EventSource {
  private readonly contract: Contract;
  private readonly listeners: Array<{ eventName: string; handler: (...args: unknown[]) => void }> = [];

  public constructor(provider: JsonRpcProvider, config: RelayerConfig) {
    this.contract = new Contract(config.contractAddress, config.contractAbi, provider);
  }

  public subscribe(topic: string, listener: (log: ChainLog) => void): void {
    const event = this.contract.interface.getEvent(topic);
    if (!event) throw new Error(`Contract ABI does not define event for topic ${topic}`);
    const handler = (...args: unknown[]) => {
      const payload = args[args.length - 1] as { log?: { topics: string[]; data: string; transactionHash: string; blockNumber: number; removed?: boolean } };
      if (!payload?.log) return;
      listener(payload.log);
    };
    this.contract.on(event.name, handler);
    this.listeners.push({ eventName: event.name, handler });
  }

  public unsubscribe(): void {
    for (const { eventName, handler } of this.listeners) this.contract.off(eventName, handler);
    this.listeners.length = 0;
  }
}
