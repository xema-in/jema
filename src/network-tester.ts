import { Observable } from 'rxjs';
import { Rxios } from './_external/rxios';

export class NetworkTester {

    /**
    * Test connection to the Xema Platform
    */

    constructor() { }

    ping(url: string): Observable<any> {
        const remote = new Rxios({
            baseURL: url,
        });
        return remote.get('/api/Setup/Ping');
    }

}
