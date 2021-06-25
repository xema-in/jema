import { LogType } from "./log-type";

export interface LogEntry {
    context: string;
    type: LogType;
    message: any;
}
