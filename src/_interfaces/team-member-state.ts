export interface TeamMemberState {

    agentId: string;
    name: string;

    connected: boolean;
    agentStatus: string;
    agentSubStatus: string;

    waitingForBreak: boolean;
    breakTypeCode: number;
    breakReason: string;
    inBreak: boolean;
    breakTimestamp: Date;

    hasPhone: boolean;
    phoneId: string;
    phoneStatus: string;

    hasTask: boolean;
    taskId: string;
    queueName: string;
    callerId: string;
    ahtTarget: number;

    taskTimestamp: Date;
    currentCallTimestamp: Date;
    wrapUpTimestamp: Date;

}
