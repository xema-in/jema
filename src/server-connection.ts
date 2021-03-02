import * as signalR from "@microsoft/signalr";
import * as Collections from 'typescript-collections';

import { Subject, BehaviorSubject, ReplaySubject } from "rxjs";
import { tap } from 'rxjs/operators';
import { Rxios } from "rxios";

import { ActiveCall } from "./_interfaces/active-call";
import { BreakState } from "./_interfaces/break-state";
import { BreakStateCode } from "./_interfaces/break-state-code";
import { Channel } from "./_interfaces/channel";
import { ChatMessage } from "./_interfaces/chat.message";
import { Conference } from "./_interfaces/conference";
import { ConnectionState } from "./_interfaces/connection-state";
import { DeviceMapParameters } from "./_interfaces/device.map";
import { EndCall } from "./_interfaces/end-call";
import { LogEntry } from "./_interfaces/log-entry";
import { PhoneState } from "./_interfaces/phone-state";
import { QueryParameters } from "./_interfaces/query-parameters";
import { QueueUpdate } from "./_interfaces/queue-update";
import { TeamMemberState } from "./_interfaces/team-member-state";
import { Info } from "./_interfaces/info";
import { TeamMemberUpdate } from "./_interfaces/team-member-update";
import { QueueState } from "./_interfaces/queue-state";

export class ServerConnection {


  //#region connection variables

  private backendUrl: string;
  private token: string;
  private remote: Rxios;
  private connection!: signalR.HubConnection;

  private userLoggedout = false;
  private userRemoteLoggedout = false;

  //#endregion


  //#region obserables

  /**
   * Receive logs from the libary
   */
  public logger = new Subject<LogEntry>();

  /**
   * Server connection status
   * Default: { connected: false, state: 'Unknown' }
   */
  public connectionState = new BehaviorSubject<ConnectionState>({
    connected: false,
    state: 'Unknown',
  });

  /**
   * Associated Phone status
   * Default: { device: 'Unknown', state: 'Unknown' }
   */
  public phoneState = new BehaviorSubject<PhoneState>({
    device: 'Unknown',
    state: 'Unknown',
  });

  /**
   * User Break status
   */
  public breakState = new BehaviorSubject<BreakState>({
    bsCode: BreakStateCode.InBreak,
    type: 0,
    reason: '',
  });

  /**
   * User Info
   */
  public info = new ReplaySubject<Info>(1);

  // TODO: chat
  public messageReceived = new Subject<ChatMessage>();
  public chatMessages = new Subject<ChatMessage>();

  // ongoing calls
  private ongoingCallsCache: Array<ActiveCall> = [];
  public ongoingCalls = new ReplaySubject<Array<ActiveCall>>(1);

  private parkedChannelsCache: Array<Channel> = [];
  public parkedChannels = new ReplaySubject<Array<Channel>>(1);

  private conferenceCallCache: Conference | undefined;
  public conferenceCall = new ReplaySubject<Conference>(1);

  // task
  public task = new ReplaySubject<any>(1);

  // queue updates
  private queueStatesCache = new Collections.Dictionary<string, QueueState>();
  public queueStates = new BehaviorSubject<Array<QueueState>>([]);

  // team status
  private teamMemberStatesCache = new Collections.Dictionary<string, TeamMemberState>();
  public teamMemberStates = new BehaviorSubject<Array<TeamMemberState>>([]);
  public teamMemberState = new Subject<TeamMemberState>();

  // other
  public hangup = new Subject<any>();

  //#endregion


  /**
   * Create a connection to the Xema Platform
   */

  constructor(url: string, token: string) {
    this.backendUrl = url;
    this.token = token;
    this.remote = new Rxios({
      baseURL: this.backendUrl,
      headers: {
        common: {
          Authorization: `Bearer ${token}`,
        },
      },
    });
  }


  //#region logger

  /**
   * Report debug information to the application
   * @param context 
   * @param message 
   */

  private log(context: string, message: any) {
    this.logger.next({ context: context, message: message });
  }

  //#endregion


  /**
   * Connect to server using web sockets
   */

  public connect(): void {
    this.userLoggedout = false;
    this.userRemoteLoggedout = false;

    this.setupSignalR();

    // lastly, connect to signalR
    this.connection
      .start()
      .then(() => {
        this.log("SignalR-Connected", null);
        this.connectionState.next({ state: "Connected", connected: true });
        this.connection.send("AgentInfo");
      })
      .catch((err) => {
        this.log("SignalR-Error", err);
        if (this.connectionState.value.state === "LoggedIn") {
          this.retry();
        }
      });
  }

  retry(): void {
    // setTimeout(() => {
    //     this.connect();
    // }, 10000);
  }

  public disconnect(): void {
    this.userLoggedout = true;
    this.connection.stop();
  }

  private setupSignalR(): void {
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(`${this.backendUrl}/agents?access_token=${this.token}`)
      .build();

    //#region connection status 

    // websocket connection disconnected
    this.connection.onclose((err) => {
      this.log("SignalR-OnClose", err);

      const currentPhoneState = this.phoneState.value;
      currentPhoneState.state = "Unknown";
      this.phoneState.next(currentPhoneState);

      if (this.userLoggedout) {
        this.connectionState.next({ state: "Logout", connected: false });
      } else if (this.userRemoteLoggedout) {
        this.connectionState.next({ state: "RemoteLogout", connected: false });
      } else {
        this.connectionState.next({ state: "Disconnected", connected: false });
        if (this.connectionState.value.state === "LoggedIn") {
          this.retry();
        }
      }

    });

    //#endregion

    //#region RemoteLogout

    ((functionName: string) => {
      this.connection.on(functionName, () => {
        this.userRemoteLoggedout = true;
        this.connection.stop();
      });
    })("RemoteLogout");

    //#endregion

    //#region unused

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
      });
    })("Broadcast");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
      });
    })("Echo");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
      });
    })("Whoami");


    //#endregion

    //#region basics

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.processIdCard(message);
      });
    })("IdCard");

    // agentinfo
    ((functionName: string) => {
      this.connection.on(functionName, (message: Info) => {
        this.log(functionName, message);
        this.info.next(message);
        if (message.agentRoles.teamLead || message.agentRoles.manager) {
          this.getAgentList();
        }
      });
    })("AgentInfo");

    //#endregion

    //#region phone status

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.phoneState.next(message);
      });
    })("DeviceState");

    //#endregion

    //#region remote party connected VarSetBridgePeer

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.processCallEvents(functionName, message);
      });
    })("VarSetBridgePeer");

    //#endregion

    //#region Parked Calls

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.processParkEvents(functionName, message);
      });
    })("ParkedCall");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.processParkEvents(functionName, message);
      });
    })("ParkedCallGiveUp");

    //#endregion

    //#region calls from queue

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.processCallEvents(functionName, message);
      });
    })("AgentConnect");
    //#endregion

    //#region Confbridge

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.processConferenceEvents(functionName, message);
      });
    })("ConfbridgeStart");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.processConferenceEvents(functionName, message);
      });
    })("ConfbridgeJoin");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.processConferenceEvents(functionName, message);
      });
    })("ConfbridgeLeave");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.processConferenceEvents(functionName, message);
      });
    })("ConfbridgeEnd");

    //#endregion

    //#region Monitoring

    // queue status update
    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.processQueueUpdates(message);
      });
    })("QueueSize");

    // team monitoring
    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.processTeamMemberState(message);
      });
    })("TeamMemberState");

    //#endregion

    //#region Breaks

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.breakState.next({ bsCode: BreakStateCode.WaitingForBreak, type: message.breakTypeCode, reason: message.breakReason });
      });
    })("TakeBreak");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.breakState.next({ bsCode: BreakStateCode.NotInBreak, type: -1, reason: '' });
      });
    })("CancelBreak");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.breakState.next({ bsCode: BreakStateCode.InBreak, type: message.breakTypeCode, reason: message.breakReason });
      });
    })("EnterBreak");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.breakState.next({ bsCode: BreakStateCode.NotInBreak, type: -1, reason: '' });
      });
    })("ExitBreak");

    //#endregion

    //#region Chat

    ((functionName: string) => {
      this.connection.on(functionName, (message: ChatMessage) => {
        this.log(functionName, message);
        this.messageReceived.next(message);
      });
    })("ReceiveMessage");

    //#endregion

  }



  // *** MESSAGE PROCESSING ***

  //#region  processCallEvents

  private processCallEvents(event: string, message: any) {
    switch (event) {
      case "VarSetBridgePeer":
        if (message.value === null) {
          // remote channel disconnected. Park or CallDrop
          this.ongoingCallsCache = this.ongoingCallsCache.filter(
            (x) => x.localChannel !== message.channel
          );
        } else {
          const duplicateCall = this.ongoingCallsCache.find(
            (x) => x.remoteChannel === message.value
          );
          // console.assert(duplicateCall === undefined, 'Call is already active!');
          if (duplicateCall === undefined) {
            const activeCall: ActiveCall = {
              localChannel: message.channel,
              remoteChannel: message.value,
              cli: message.attributes.connectedlinenum,
            };
            this.ongoingCallsCache = this.ongoingCallsCache.filter(
              (x) => x.remoteChannel !== activeCall.remoteChannel
            );
            this.ongoingCallsCache.push(activeCall);
          }
        }
        break;
      case "AgentConnect": // fired when call is sent from queue
        // register new task
        this.task.next(message);
        break;
    }

    this.ongoingCalls.next(this.ongoingCallsCache);
  }

  //#endregion


  //#region processParkEvents

  private processParkEvents(event: string, message: any) {
    switch (event) {
      case "ParkedCall":
        const parkedChannel = {
          channel: message.attributes.parkeechannel,
          cli: message.attributes.parkeecalleridnum,
          status: "Parked",
        };
        this.parkedChannelsCache.push(parkedChannel);
        break;
      case "ParkedCallGiveUp":
        this.parkedChannelsCache = this.parkedChannelsCache.filter(
          (x) => x.channel !== message.attributes.parkeechannel
        );
        break;
    }
    this.parkedChannels.next(this.parkedChannelsCache);
  }

  //#endregion


  //#region processConferenceEvents

  private processConferenceEvents(event: string, message: any) {
    switch (event) {
      case "ConfbridgeStart":
        this.conferenceCallCache = {
          id: message.conference,
          members: [],
        };
        break;
      case "ConfbridgeJoin":
        if (
          this.conferenceCallCache !== undefined &&
          this.conferenceCallCache.members.length < 2
        ) {
          this.conferenceCallCache.members.push({
            channel: message.channel,
            cli: message.callerIDnum,
            status: "InConference",
          });
        }
        break;
      case "ConfbridgeLeave":
        if (this.conferenceCallCache !== undefined) {
          this.conferenceCallCache.members = this.conferenceCallCache.members.filter(
            (x) => x.channel !== message.channel
          );
        }
        break;
      case "ConfbridgeEnd":
        this.conferenceCallCache = undefined;
        break;
    }
    this.conferenceCall.next(this.conferenceCallCache);
  }

  //#endregion


  //#region processQueueUpdates

  private processQueueUpdates(message: QueueUpdate) {

    this.queueStatesCache.setValue(message.queue, {
      queue: message.queue,
      size: message.size,
      maxWaitTimestamp: message.maxWaitTimestamp,
      callsEntered: message.callVolume.callsEntered,
      callsConnected: message.callVolume.callsConnected,
      agentsConnected: message.agentCapacity.agentsConnected,
      agentsActive: message.agentCapacity.agentsActive,
    });

    this.queueStates.next(this.queueStatesCache.values());
  }

  //#endregion


  //#region processTeamMemberState

  private processTeamMemberState(message: TeamMemberUpdate) {

    if (!this.teamMemberStatesCache.containsKey(message.agentId)) {
      this.connection.send("AskId", message.agentId);
      return;
    }

    let activeAgent = this.teamMemberStatesCache.getValue(message.agentId);
    if (activeAgent === undefined) return; // do i need this? why?

    switch (message.event) {
      case "EndpointDetail":
      case "DeviceStateChanged":
        switch (message.phoneState) {
          case "INUSE":
            activeAgent.phoneStatus = "In Call";
            activeAgent.agentSubStatus = "In Call";
            activeAgent.currentCallTimestamp = new Date();
            break;
          case "Not in use":
          case "NOT_INUSE":
            activeAgent.phoneStatus = "Idle";
            if (activeAgent.hasTask) {
              activeAgent.agentSubStatus = "Wrap Up";
              activeAgent.wrapUpTimestamp = new Date();
            }
            break;
          case "RINGING":
            activeAgent.phoneStatus = "Ringing";
            break;
          case "Unavailable":
          case "UNAVAILABLE":
            activeAgent.phoneStatus = "Offline";
            break;
          default:
            activeAgent.phoneStatus = message.phoneState;
            break;
        }
        break;

      case "TaskAssigned":
        activeAgent.hasTask = true;
        activeAgent.agentStatus = "Busy";
        activeAgent.taskId = message.taskId;
        activeAgent.queueName = message.queueName;
        activeAgent.callerId = message.callerId;
        activeAgent.ahtTarget = message.ahtTarget;
        activeAgent.taskTimestamp = new Date();
        break;

      case "TaskCompleted":
        activeAgent.hasTask = false;
        activeAgent.agentStatus = "Ready";
        activeAgent.agentSubStatus = "";
        activeAgent.taskId = "";
        activeAgent.queueName = "";
        activeAgent.callerId = "";
        activeAgent.ahtTarget = -1;
        break;

      case "BreakRequested":
        activeAgent.waitingForBreak = true;
        activeAgent.breakTypeCode = message.breakTypeCode;
        activeAgent.breakReason = message.breakReason;
        break;

      case "BreakCancelled":
        activeAgent.waitingForBreak = false;
        activeAgent.breakTypeCode = -1;
        activeAgent.breakReason = '';
        break;

      case "BreakStarted":
        activeAgent.waitingForBreak = false;
        activeAgent.inBreak = true;
        activeAgent.breakTypeCode = message.breakTypeCode;
        activeAgent.breakReason = message.breakReason;
        activeAgent.breakTimestamp = new Date();
        activeAgent.agentStatus = "InBreak";
        break;

      case "BreakEnded":
        activeAgent.inBreak = false;
        activeAgent.breakTypeCode = -1;
        activeAgent.breakReason = '';
        activeAgent.agentStatus = "Ready";
        break;

      case "Connected":
        activeAgent.connected = true;
        activeAgent.agentStatus = "Connecting ...";
        activeAgent.hasPhone = false;
        break;

      case "Disconnected":
        activeAgent.connected = false;
        activeAgent.agentStatus = "Disconnected";
        break;

      case "PhoneAssigned":
        activeAgent.hasPhone = true;
        activeAgent.agentStatus = "Logged In";
        activeAgent.phoneId = message.phoneId;
        break;

      case "PhoneUnassigned":
        activeAgent.hasPhone = false;
        activeAgent.agentStatus = "No Phone";
        activeAgent.phoneId = '';
        break;

      default:
        this.log('TeamMemberState', 'Unhandled Team Member State reported ... ' + message.event);
        break;
    }

    this.teamMemberState.next(activeAgent);
    this.teamMemberStates.next(this.teamMemberStatesCache.values());
  }

  //#endregion


  //#region processIdCard

  private processIdCard(message: any) {
    if (!this.teamMemberStatesCache.containsKey(message.agentId)) {
      this.teamMemberStatesCache.setValue(message.agentId, this.discoverAgentState(message));
      this.teamMemberStates.next(this.teamMemberStatesCache.values());
    }
  }

  private discoverAgentState(message: any): TeamMemberState {
    const agent: TeamMemberState = {
      agentId: message.agentId,
      name: message.name,
      connected: message.online,
      agentStatus: '', // infer
      agentSubStatus: '', // infer
      waitingForBreak: message.waitingBreak,
      breakTypeCode: -1, // infer
      breakReason: message.breakReason,
      inBreak: message.inBreak,
      breakTimestamp: new Date(),  // infer
      hasPhone: message.hasPhone,
      phoneId: message.phoneId,
      phoneStatus: '',  // infer
      hasTask: message.onTask,
      taskId: message.taskId,
      queueName: '',  // infer
      callerId: '',  // infer
      ahtTarget: -1,  // infer
      taskTimestamp: new Date(), // infer
      currentCallTimestamp: new Date(), // infer
      wrapUpTimestamp: new Date(), // infer
    };

    // if (message.state === 'InBreak') agent.agentStatus = 'In Break';
    // else if (message.state === 'NoPhone') agent.agentStatus = 'No Phone';
    // else if (message.state === 'Busy') agent.agentStatus = 'Busy';
    // else if (message.state === 'Idle') agent.agentStatus = 'Ready';
    // else agent.agentStatus = message.state;

    agent.agentStatus = message.state;

    return agent;
  }

  //#endregion



  // *** SIGNALR SERVER FUNCTIONS ***

  //#region signalr methods

  // chat
  public sendChatMessage(message: ChatMessage): void {
    this.log("SignalR", "SendMessage");
    this.connection.send("SendMessage", message);
  }

  public sendGroupChatMessage(message: ChatMessage): void {
    this.log("SignalR", "SendToGroup");
    this.connection.send("SendToGroup", message);
  }

  // breaks
  public askBreak2(btCode: number, reason: string) {
    this.log("SignalR", "AskBreak2");
    this.connection.send("AskBreak2", btCode, reason);
  }

  public cancelBreak() {
    this.log("SignalR", "CancelBreak");
    this.connection.send("CancelBreak");
  }

  public exitBreak() {
    this.log("SignalR", "ExitBreak");
    this.connection.send("ExitBreak");
  }

  // call management
  public hold(channel: string): void {
    this.log("SignalR", "Hold");
    this.connection.send("Hold", channel);
  }

  public resume(channel: string): void {
    this.log("SignalR", "Resume");
    this.connection.send("Resume", channel);
  }

  public call(trunk: string, cli: string, callid: string): void {
    this.log("SignalR", "Call");
    this.connection.send("Call", trunk, cli, callid);
  }

  public hangupCall(channel: string): void {
    this.log("SignalR", "Hangup");
    this.connection.send("Hangup", channel);
  }

  public conference(channels: string[]): void {
    this.log("SignalR", "Conference");
    this.connection.send("Conference", channels);
  }

  public dispose(): void {
    this.log("SignalR", "DisposeCall");
    this.connection.send("DisposeCall");
  }

  public barge(targetdeviceid: string): void {
    this.log("SignalR", "Barge");
    this.connection.send("Barge", targetdeviceid);
  }

  //#endregion



  // *** REST APIs ***

  //#region private api methods

  private getAgentList() {
    return this.remote.post("/api/GetAgentList", {})
      .subscribe(
        (data: any) => {
          data.forEach((message: any) => {
            if (!this.teamMemberStatesCache.containsKey(message.agentId))
              this.teamMemberStatesCache.setValue(message.agentId, this.discoverAgentState(message));
          });
          this.teamMemberStates.next(this.teamMemberStatesCache.values());
        }
      );
  }

  //#endregion


  //#region web api methods

  public IsAgentAuthenticated() {
    this.log("Api", "IsAgentAuthenticated2");
    return this.remote.get("/api/Account/IsAgentAuthenticated2", {});
  }

  public IsOnline() {
    this.log("Api", "IsAgentOnline");
    return this.remote.post("/api/Account/IsAgentOnline", {});
  }

  public RemoteLogout() {
    this.log("Api", "LogoutAgentActiveSession");
    return this.remote.post("/api/Account/LogoutAgentActiveSession", {});
  }

  public ForceRemoteLogout() {
    this.log("Api", "ForceLogoutAgentActiveSession");
    return this.remote.post("/api/Account/ForceLogoutAgentActiveSession", {});
  }

  public IsPhoneMapped() {
    this.log("Api", "IsPhoneMapped");
    return this.remote.post("/api/Account/IsPhoneMapped", {});
  }

  public mapPhone(param: DeviceMapParameters) {
    this.log("Api", "AgentLogin");
    return this.remote.post("/api/Devices/AgentLogin", param)
      .pipe(
        tap(() => {
          this.connection.send("RefreshPhoneState");
        })
      );
  }

  public unassignPhone() {
    this.log("Api", "UnassignPhone");
    return this.remote.post("/api/Devices/UnassignPhone", {});
  }

  public endcall(param: EndCall) {
    this.log("Api", "HangupCall");
    return this.remote.post("/api/Call/HangupCall", param);
  }

  public getAgents() {
    this.log("Api", "GetTeamMembers");
    return this.remote.post("/api/Agents/GetTeamMembers", {});
  }

  public getCallHistory(param: QueryParameters) {
    this.log("Api", "Cdrs");
    return this.remote.post("/api/Cdrs", param);
  }

  //#endregion


}
