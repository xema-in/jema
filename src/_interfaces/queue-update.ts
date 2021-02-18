import { CallVolume } from "./call-volume";
import { AgentCapacity } from "./agent-capacity";

export interface QueueUpdate {
  queue: string;
  size: number;
  maxWaitTimestamp: any;
  callVolume: CallVolume;
  agentCapacity: AgentCapacity;
}
