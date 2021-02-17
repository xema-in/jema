export interface TeamMemberUpdate {

    event: string;
    agentId: string;

    device: string;
    state: string;

    queue: string;
    caller: string;
    callUniqueId: string;

    // agentStatus: string;

    // waitingForBreak: boolean;
    // breakTimestamp: Date;

    // deviceStatus: string;

    // queueName: string;
    // callUniqueId: string;
    // caller: string;
    // queueCallTimestamp: Date;

    // currentCallTimestamp: Date;
    // wrapUpTimestamp: Date;

}
