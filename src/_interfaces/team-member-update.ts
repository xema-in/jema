export interface TeamMemberUpdate {

    event: string;
    agentId: string;
    agentState: string;

    phoneId: string;
    phoneState: string;

    breakTypeCode: number;
    breakReason: string;
    breakStartTimestamp: Date;

    taskId: string;
    queueName: string;
    callerId: string;
    ahtTarget: number;

}
