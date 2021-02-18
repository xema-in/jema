export interface TeamMemberUpdate {

    event: string;
    agentId: string;

    phoneId: string;
    phoneState: string;

    breakTypeCode: number;
    breakReason: string;

    taskId: string;
    queueName: string;
    callerId: string;
    ahtTarget: number;

}
