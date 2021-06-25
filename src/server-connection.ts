import * as signalR from "@microsoft/signalr";
import * as Collections from 'typescript-collections';

import { Subject, BehaviorSubject, ReplaySubject, Observable } from "rxjs";
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
import { DialerState } from "./_interfaces/dialer-state";
import { GuiType } from "./_interfaces/gui-type";
import { MissedCall } from "./_interfaces/missed-call";
import { LogType } from "./_interfaces/log-type";

export class ServerConnection {

  //#region connection variables

  private backendUrl: string;
  private token: string;
  private guiType: GuiType;

  private remote: Rxios;
  private connection!: signalR.HubConnection;

  private agentPhoneId: string = '';
  private bargePhoneId: string = '';

  private userLoggedout = false;
  private userRemoteLoggedout = false;

  private connectionAttemptCounter = 0;
  private connectionCounter = 0;
  private reconnect = false;
  private retryCount = 0;
  private maxRetryCount = 100;

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

  // missed call
  public missedCall = new Subject<MissedCall>();

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

  // dialer updates
  private dialerStatesCache = new Collections.Dictionary<string, DialerState>();
  public dialerStates = new BehaviorSubject<Array<DialerState>>([]);

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

  constructor(url: string, token: string, primaryGuiType: GuiType) {
    this.backendUrl = url;
    this.token = token;
    this.guiType = primaryGuiType;

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

  private log(context: string, message: any, type: LogType) {
    this.logger.next({ context: context, message: message, type: type });
  }

  //#endregion


  /**
   * Connect to server using web sockets
   */

  public connect(): void {
    this.userLoggedout = false;
    this.userRemoteLoggedout = false;
    this.connectionAttemptCounter++;
    this.retryCount++;

    this.setupSignalR();

    // lastly, connect to signalR
    this.connection
      .start()
      .then(() => {
        this.connectionCounter++;
        this.retryCount = 0;
        this.log("SignalR-Connected", { attempts: this.connectionAttemptCounter, connected: this.connectionCounter }, LogType.Warning);

        if (!this.reconnect) {
          this.connectionState.next({ state: "Connected", connected: true });
        } else {
          this.connectionState.next({ state: "Reconnected", connected: true });
        }

        switch (this.guiType) {
          case GuiType.Agent:
            this.connection.send("ActivateAgent");
            this.connection.send("ActivateMonitor"); // TL
            this.connection.send("AgentInfo");
            if (this.reconnect && this.agentPhoneId != '') {
              this.ActivateAgentAudioChannel(this.agentPhoneId);
            }
            break;
          case GuiType.LiveView:
            this.connection.send("ActivateMonitor"); // TL & Manager
            if (this.reconnect && this.bargePhoneId != '') {
              this.ActivateBargeAudioChannel(this.bargePhoneId);
            }
            break;
        }
      })
      .catch((err) => {
        this.log("SignalR-Error", { attempts: this.connectionAttemptCounter, connected: this.connectionCounter }, LogType.Warning);
        this.retry();
      });
  }

  private retry(): void {
    this.log("SignalR-Retry", this.retryCount, LogType.Warning);
    setTimeout(() => {
      this.connect();
    }, 1000);
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
      this.log("SignalR-OnClose", null, LogType.Warning);

      const currentPhoneState = this.phoneState.value;
      currentPhoneState.state = "Unknown";
      this.phoneState.next(currentPhoneState);

      if (this.userLoggedout) {
        this.connectionState.next({ state: "Logout", connected: false });
      } else if (this.userRemoteLoggedout) {
        this.connectionState.next({ state: "RemoteLogout", connected: false });
      } else if (this.retryCount < this.maxRetryCount) {
        this.reconnect = true;
        this.connectionState.next({ state: "Reconnecting", connected: false });
        this.retry();
      } else {
        this.connectionState.next({ state: "Disconnected", connected: false });
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

    //#region diagnostics

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.connection.send("Pong", message);
      });
    })("Ping");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
      });
    })("Broadcast");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
      });
    })("Echo");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
      });
    })("Whoami");


    //#endregion

    //#region basics

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.processIdCard(message);
      });
    })("IdCard");

    // agentinfo
    ((functionName: string) => {
      this.connection.on(functionName, (message: Info) => {
        this.log(functionName, message, LogType.Log);
        this.info.next(message);
        if (message.agentRoles.teamLead || message.agentRoles.manager) {
          this.getAgentList();
        }
      });
    })("AgentInfo");

    // missed call
    ((functionName: string) => {
      this.connection.on(functionName, (message: MissedCall) => {
        this.log(functionName, message, LogType.Log);
        this.missedCall.next(message);
      });
    })("MissedCall");

    //#endregion

    //#region phone status

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.phoneState.next(message);
      });
    })("DeviceState");

    //#endregion

    //#region remote party connected VarSetBridgePeer

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.processCallEvents(functionName, message);
      });
    })("VarSetBridgePeer");

    //#endregion

    //#region Parked Calls

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.processParkEvents(functionName, message);
      });
    })("ParkedCall");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.processParkEvents(functionName, message);
      });
    })("ParkedCallGiveUp");

    //#endregion

    //#region calls from queue

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.processCallEvents(functionName, message);
      });
    })("AgentConnect");
    //#endregion

    //#region Confbridge

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.processConferenceEvents(functionName, message);
      });
    })("ConfbridgeStart");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.processConferenceEvents(functionName, message);
      });
    })("ConfbridgeJoin");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.processConferenceEvents(functionName, message);
      });
    })("ConfbridgeLeave");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.processConferenceEvents(functionName, message);
      });
    })("ConfbridgeEnd");

    //#endregion

    //#region Monitoring

    // dialer status update
    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.processDialerUpdates(message);
      });
    })("DialerProgress");

    // queue status update
    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.processQueueUpdates(message);
      });
    })("QueueSize");

    // team monitoring
    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.processTeamMemberState(message);
      });
    })("TeamMemberState");

    //#endregion

    //#region Breaks

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.breakState.next({ bsCode: BreakStateCode.WaitingForBreak, type: message.breakTypeCode, reason: message.breakReason });
      });
    })("TakeBreak");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.breakState.next({ bsCode: BreakStateCode.NotInBreak, type: -1, reason: '' });
      });
    })("CancelBreak");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.breakState.next({ bsCode: BreakStateCode.InBreak, type: message.breakTypeCode, reason: message.breakReason });
      });
    })("EnterBreak");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message, LogType.Log);
        this.breakState.next({ bsCode: BreakStateCode.NotInBreak, type: -1, reason: '' });
      });
    })("ExitBreak");

    //#endregion

    //#region Chat

    ((functionName: string) => {
      this.connection.on(functionName, (message: ChatMessage) => {
        this.log(functionName, message, LogType.Log);
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


  //#region processDialerUpdates

  private processDialerUpdates(message: DialerState) {
    this.dialerStatesCache.setValue(message.id.toString(), message);

    this.dialerStates.next(this.dialerStatesCache.values());
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
      case "AgentStateChanged": {
        activeAgent.agentStatus = message.agentState;
        break;
      }

      case "EndpointDetail":
      case "DeviceStateChanged":
        switch (message.phoneState) {
          case "INUSE":
            activeAgent.phoneStatus = "In Call";
            activeAgent.agentSubStatus = "Working";
            activeAgent.currentCallTimestamp = new Date();
            break;
          case "Not in use":
          case "NOT_INUSE":
            activeAgent.phoneStatus = "Idle";
            if (activeAgent.hasTask) {
              activeAgent.agentSubStatus = "Closing";
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
        activeAgent.taskId = message.taskId;
        activeAgent.queueName = message.queueName;
        activeAgent.callerId = message.callerId;
        activeAgent.ahtTarget = message.ahtTarget;
        activeAgent.taskTimestamp = new Date();
        break;

      case "TaskCompleted":
        activeAgent.hasTask = false;
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
        activeAgent.breakTimestamp = new Date(message.breakStartTimestamp);
        break;

      case "BreakEnded":
        activeAgent.inBreak = false;
        activeAgent.breakTypeCode = -1;
        activeAgent.breakReason = '';
        break;

      case "Connected":
        activeAgent.connected = true;
        activeAgent.hasPhone = false;
        break;

      case "Disconnected":
        activeAgent.connected = false;
        break;

      case "PhoneAssigned":
        activeAgent.hasPhone = true;
        activeAgent.phoneId = message.phoneId;
        break;

      case "PhoneUnassigned":
        activeAgent.hasPhone = false;
        activeAgent.phoneId = '';
        break;

      default:
        this.log('TeamMemberState', 'Unhandled Team Member State reported ... ' + message.event, LogType.Log);
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
      agentStatus: message.state,
      agentSubStatus: message.busyState,
      waitingForBreak: message.waitingBreak,
      breakTypeCode: -1, // infer
      breakReason: message.breakReason,
      inBreak: message.inBreak,
      breakTimestamp: new Date(message.breakStartTimestamp),  // infer
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

    return agent;
  }

  //#endregion



  // *** User Initiated Actions ***

  //#region methods

  // chat
  public sendChatMessage(message: ChatMessage): void {
    this.log("SignalR", "SendMessage", LogType.Log);
    this.connection.send("SendMessage", message);
  }

  public sendGroupChatMessage(message: ChatMessage): void {
    this.log("SignalR", "SendToGroup", LogType.Log);
    this.connection.send("SendToGroup", message);
  }

  // breaks
  public askBreak2(btCode: number, reason: string) {
    this.log("SignalR", "AskBreak2", LogType.Log);
    this.connection.send("AskBreak2", btCode, reason);
  }

  public cancelBreak() {
    this.log("SignalR", "CancelBreak", LogType.Log);
    this.connection.send("CancelBreak");
  }

  public exitBreak() {
    this.log("SignalR", "ExitBreak", LogType.Log);
    this.connection.send("ExitBreak");
  }

  // call management
  public hold(channel: string): void {
    this.log("SignalR", "Hold", LogType.Log);
    this.connection.send("Hold", channel);
  }

  public resume(channel: string): void {
    this.log("SignalR", "Resume", LogType.Log);
    this.connection.send("Resume", channel);
  }

  public call(trunk: string, cli: string, callid: string): void {
    this.log("SignalR", "Call", LogType.Log);
    this.connection.send("Call", trunk, cli, callid);
  }

  public hangupCall(channel: string): void {
    this.log("SignalR", "Hangup", LogType.Log);
    this.connection.send("Hangup", channel);
  }

  public conference(channels: string[]): void {
    this.log("SignalR", "Conference", LogType.Log);
    this.connection.send("Conference", channels);
  }

  /** 
   * Dispose the task
   */
  public dispose(): void {
    this.log("SignalR", "DisposeCall", LogType.Log);
    this.connection.send("DisposeCall");
  }

  public barge(targetdeviceid: string): void {
    this.log("SignalR", "Barge", LogType.Log);
    this.connection.send("Barge", targetdeviceid);
  }

  public whisper(targetdeviceid: string): void {
    this.log("SignalR", "Whisper", LogType.Log);
    this.connection.send("Whisper", targetdeviceid);
  }

  public spy(targetdeviceid: string): void {
    this.log("SignalR", "Spy", LogType.Log);
    this.connection.send("Spy", targetdeviceid);
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
    this.log("Api", "IsAgentAuthenticated2", LogType.Log);
    return this.remote.get("/api/Account/IsAgentAuthenticated2", {});
  }

  public IsOnline() {
    this.log("Api", "IsAgentOnline", LogType.Log);
    return this.remote.post("/api/Account/IsAgentOnline", {});
  }

  public RemoteLogout() {
    this.log("Api", "LogoutAgentActiveSession", LogType.Log);
    return this.remote.post("/api/Account/LogoutAgentActiveSession", {});
  }

  public ForceRemoteLogout() {
    this.log("Api", "ForceLogoutAgentActiveSession", LogType.Log);
    return this.remote.post("/api/Account/ForceLogoutAgentActiveSession", {});
  }

  public IsPhoneMapped() {
    this.log("Api", "IsPhoneMapped", LogType.Log);
    return this.remote.post("/api/Account/IsPhoneMapped", {});
  }

  public ActivateBargeAudioChannel(phoneId: string) {
    this.log("ActivateBargeAudioChannel", phoneId, LogType.Log);
    this.bargePhoneId = phoneId;
    this.connection.send("ActivateBargeAudioChannel", phoneId);
  }

  public ActivateAgentAudioChannel(phoneId: string) {
    this.log("Api", "AgentLogin", LogType.Log);
    this.agentPhoneId = phoneId;
    return this.remote.post("/api/Devices/AgentLogin", { deviceName: phoneId })
      .pipe(
        tap(() => {
          this.connection.send("RefreshPhoneState");
        })
      );
  }

  /**
   * @deprecated Use ActivateAgentAudioChannel() method.
   */
  public mapPhone(param: DeviceMapParameters) {
    return this.ActivateAgentAudioChannel(param.deviceName);
  }

  /**
   * @deprecated This functionality is removed
   */
  public unassignPhone() {
    this.log("Deprecated", "UnassignPhone", LogType.Log);
    // this.log("Api", "UnassignPhone");
    // return this.remote.post("/api/Devices/UnassignPhone", {});
    return new Observable(obs => {
      obs.next({ message: 'This functionality is removed' });
      obs.complete();
    })
  }

  public endcall(param: EndCall) {
    this.log("Api", "HangupCall", LogType.Log);
    return this.remote.post("/api/Call/HangupCall", param);
  }

  public getAgents() {
    this.log("Api", "GetTeamMembers", LogType.Log);
    return this.remote.post("/api/Agents/GetTeamMembers", {});
  }

  public getCallHistory(param: QueryParameters) {
    this.log("Api", "Cdrs", LogType.Log);
    return this.remote.post("/api/Cdrs", param);
  }

  public getAgentMissedCalls() {
    this.log("Api", "AgentMissedCalls", LogType.Log);
    return this.remote.post("/api/AgentMissedCalls", {});
  }

  //#endregion


}
