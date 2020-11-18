export class TeamMemberState {

    agentId!: string;
    name!: string;
    firstLoginTime!: string;

    device!: string;
    deviceStatus!: string;
    deviceStatusCss!: string;
    currentCallTimestamp!: Date | null;

    agentStatus!: string;

    queueName!: string;
    caller!: string;
    queueCallTimestamp!: Date | null;
    callUniqueId!: string;

    wrapUpTimestamp!: Date | null;

    waitingForBreak!: boolean;
    breakTimestamp!: Date | null;

}
