export interface MissedCall {
    phoneId: string;
    originNumber: string;
    dialledNumber: string;
    queueName: string;
    callId: string;
    timestamp: Date;
}
