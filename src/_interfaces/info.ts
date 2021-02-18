import { AgentInfo } from "./agent-info";
import { AgentRoles } from "./agent-roles";
import { BreakType } from "./break-type";

export interface Info {
    agentInfo: AgentInfo;
    agentRoles: AgentRoles;
    breakTypes: BreakType[];
}
