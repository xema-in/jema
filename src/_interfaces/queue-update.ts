import { CallVolume } from "./call-volume";
import { AgentCapacity } from "./agent-capacity";

export class QueueUpdate {
  queue!: string;
  size!: number;
  maxWaitTimestamp: any;
  callVolume!: CallVolume;
  agentCapacity!: AgentCapacity;
}
