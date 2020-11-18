import { Channel } from './channel';

export class Conference {
    id!: string;
    members!: Array<Channel>;
}
