export interface TeamMemberState {

    agentId: string;
    name: string;
    firstLogin: string;
    agentStatus: string;

    waitingForBreak: boolean;
    breakTimestamp: Date;

    device: string;
    deviceStatus: string;
    deviceStatusCss: string;

    queueName: string;
    callUniqueId: string;
    caller: string;
    queueCallTimestamp: Date;

    currentCallTimestamp: Date;
    wrapUpTimestamp: Date;

}
