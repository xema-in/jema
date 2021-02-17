import { BreakStateCode } from "./break-state-code";

export interface BreakState {
    bsCode: BreakStateCode;
    type: number;
    reason: string;
}
