export interface QueueState {
  queue: string;
  size: number;
  maxWaitTimestamp: any;
  callsEntered: number;
  callsConnected: number;
  agentsConnected: number;
  agentsActive: number;
}
