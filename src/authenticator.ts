import { Rxios } from 'rxios';
import { Credentials } from './_interfaces/credentials';

export class Authenticator {

    backendUrl: string;
    remote: Rxios;

    /**
    * Create an Authenticator for Generating Bearer tokens
    */

    constructor(url: string) {
        this.backendUrl = url;
        this.remote = new Rxios({
            baseURL: this.backendUrl,
        });
    }

    /**
     * 
     * @param credentials Agent Credentials
     */

    getAuthToken(credentials: Credentials) {
        return this.remote.post('/api/Account/LoginAgent2', credentials);
    }
}
