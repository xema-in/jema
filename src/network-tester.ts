import { Rxios } from 'rxios';

export class NetworkTester {

    /**
    * Test connection to the Xema Platform
    */

    constructor() { }

    ping(url: string) {
        const remote = new Rxios({
            baseURL: url,
        });
        return remote.get('/api/Setup/Ping');
    }

}
