import { Rxios } from "rxios";
import { BehaviorSubject, ReplaySubject, Subject } from "rxjs";
import * as signalR from "@microsoft/signalr";
import { Calldispositions } from "./_interfaces/calldispositions";
import { EndCall } from "./_interfaces/end-call";
import { ChatMessage } from "./_interfaces/chat.message";
import { ActiveCall } from "./_interfaces/active-call";
import { Conference } from "./_interfaces/conference";
import { Channel } from "./_interfaces/channel";
import { QueueUpdate } from "./_interfaces/queue-update";
import { TeamMemberState } from "./_interfaces/team-member-state";
import { AgentInfo } from "./_interfaces/agent-info";
import { LogEntry } from "./_interfaces/log-entry";
import { DeviceMapParameters } from "./_interfaces/device.map";
import { ConnectionState } from "./_interfaces/connection-state";
import { PhoneState } from "./_interfaces/phone-state";
import { BreakState } from "./_interfaces/break-state";
import { BreakStateCode } from "./_interfaces/break-state-code";

export class ServerConnection {
  backendUrl: string;
  token: string;
  remote: Rxios;

  private connection!: signalR.HubConnection;
  public logger = new Subject<LogEntry>();

  // default status of connection
  public connectionState = new BehaviorSubject<ConnectionState>({
    connected: false,
    state: "Unknown",
  });

  public phoneState = new BehaviorSubject<PhoneState>({
    device: "Unknown",
    state: "Unknown",
  });

  public breakState = new BehaviorSubject<BreakState>({
    bsCode: BreakStateCode.NotInBreak,
  });

  public agentInfo = new ReplaySubject<AgentInfo>(1);

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
  private taskCache: any;
  public task = new Subject<any>();

  // queue updates
  private queueUpdatesCache: Array<QueueUpdate> = [];
  public queueUpdates = new Subject<Array<QueueUpdate>>();

  // team status
  private teamMemberStatesCache: Array<TeamMemberState> = [];
  public teamMemberStates = new Subject<Array<TeamMemberState>>();

  // other
  public hangup = new Subject<any>();

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

  // log messages received on the api
  private log(context: string, message: any) {
    this.logger.next({ context: context, message: message });
  }

  //#region signalr setup *** *** *** *** *** *** ***

  private setupSignalR(): void {
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(`${this.backendUrl}/agents?access_token=${this.token}`)
      .build();

    // websocket connection disconnected
    this.connection.onclose((err) => {
      this.log("OnClose", err);
      const currentPhoneState: any = this.phoneState.value;
      currentPhoneState.state = "Unknown";
      this.phoneState.next(currentPhoneState);

      if (this.connectionState.value.state === "LoggedIn") {
        this.retry();
      }
    });

    // methods for receiving events

    // remote logout
    ((functionName: string) => {
      this.connection.on(functionName, () => {
        this.connection.stop();
        this.connectionState.next({ state: "Remote Logout", connected: false });
      });
    })("RemoteLogout");

    // generic methods
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

    // phone status
    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.phoneState.next(message);
      });
    })("DeviceState");

    // calls
    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.processCallEvents(functionName, message);
      });
    })("VarSetBridgePeer");

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

    // calls from queue
    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.processCallEvents(functionName, message);
      });
    })("AgentConnect");

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

    // queue status update
    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.processQueueUpdates(message);
      });
    })("QueueSize");

    /// custom messages

    // team monitoring
    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.processTeamMemberState(message);
      });
    })("TeamMemberState");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.processIdCard(message);
      });
    })("IdCard");

    // break related
    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.breakState.next({ bsCode: BreakStateCode.WaitingForBreak });
      });
    })("TakeBreak");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.breakState.next({ bsCode: BreakStateCode.InBreak });
      });
    })("EnterBreak");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.breakState.next({ bsCode: BreakStateCode.NotInBreak });
      });
    })("ExitBreak");

    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.breakState.next({ bsCode: BreakStateCode.NotInBreak });
      });
    })("CancelBreak");

    // chat
    ((functionName: string) => {
      this.connection.on(functionName, (message: ChatMessage) => {
        this.log(functionName, message);
        this.messageReceived.next(message);
      });
    })("ReceiveMessage");

    // agentinfo
    ((functionName: string) => {
      this.connection.on(functionName, (message: any) => {
        this.log(functionName, message);
        this.agentInfo.next(message);
      });
    })("AgentInfo");
  }

  retry(): void {
    // setTimeout(() => {
    //     this.connect();
    // }, 10000);
  }

  connect(): void {
    this.setupSignalR();

    // lastly, connect to signalR
    this.connection
      .start()
      .then(() => {
        this.log("SignalR", "ConnectAsAgent");
        this.connection.send("ConnectAsAgent").then(() => {
          this.connectionState.next({ state: "Connected", connected: true });
        });
      })
      .catch((err) => {
        // console.error(err);
        if (this.connectionState.value.state === "LoggedIn") {
          this.retry();
        }
      });
  }

  //#endregion

  //#region processing methods *** *** *** *** *** *** ***

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
        this.taskCache = message;
        this.task.next(this.taskCache);
        break;
    }

    this.ongoingCalls.next(this.ongoingCallsCache);
  }

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

  private processQueueUpdates(message: any) {
    this.queueUpdatesCache = this.queueUpdatesCache.filter(
      (x) => x.queue !== message.queue
    );
    const queueUpdateInfo: QueueUpdate = {
      queue: message.queue,
      size: message.size,
      maxWaitTimestamp: message.maxWaitTimestamp,
      callVolume: message.callVolume,
      agentCapacity: message.agentCapacity,
    };
    this.queueUpdatesCache.push(queueUpdateInfo);
    this.queueUpdatesCache.sort((qA, qB) => {
      if (qA.queue < qB.queue) {
        return -1;
      }
      if (qA.queue > qB.queue) {
        return 1;
      }
      return 0;
    });
    this.queueUpdates.next(this.queueUpdatesCache);
  }

  private processTeamMemberState(message: any) {
    let currentStatus = this.teamMemberStatesCache.find(
      (x) => x.agentId === message.agentId
    );
    if (currentStatus === undefined) {
      const newMember: TeamMemberState = {
        agentId: message.agentId,
        name: message.agentId,
        firstLoginTime: "",
        device: "",
        deviceStatus: "",
        deviceStatusCss: "secondary",
        currentCallTimestamp: null,
        agentStatus: "",
        queueName: "",
        caller: "",
        queueCallTimestamp: null,
        callUniqueId: "",
        wrapUpTimestamp: null,
        breakTimestamp: null,
        waitingForBreak: false,
      };
      this.teamMemberStatesCache.push(newMember);
      this.askId(newMember.agentId);

      this.teamMemberStatesCache.sort((a, b) => {
        if (a.name < b.name) {
          return -1;
        }
        if (a.name > b.name) {
          return 1;
        }
        return 0;
      });

      currentStatus = this.teamMemberStatesCache.find(
        (x) => x.agentId === message.agentId
      );
    }

    if (currentStatus === undefined) return; // do i need this? why?

    switch (message.event) {
      case "EndpointDetail":
      case "DeviceStateChanged":
        currentStatus.device = message.device;
        switch (message.state) {
          case "INUSE":
            currentStatus.currentCallTimestamp = new Date();
            currentStatus.deviceStatus = "In Call";
            currentStatus.deviceStatusCss = "danger";
            break;
          case "Not in use":
          case "NOT_INUSE":
            currentStatus.deviceStatus = "Idle";
            currentStatus.deviceStatusCss = "success";
            if (currentStatus.queueName !== "") {
              currentStatus.agentStatus = "Wrap Up";
              currentStatus.wrapUpTimestamp = new Date();
            }
            break;
          case "RINGING":
            currentStatus.deviceStatus = "Ringing";
            currentStatus.deviceStatusCss = "warning";
            break;
          case "Unavailable":
          case "UNAVAILABLE":
            currentStatus.deviceStatus = "Offline";
            currentStatus.deviceStatusCss = "secondary";
            break;
          default:
            currentStatus.deviceStatus = message.state;
            currentStatus.deviceStatusCss = "secondary";
            break;
        }
        break;

      case "AgentConnect":
        currentStatus.agentStatus = "Busy";
        currentStatus.queueName = message.queue;
        currentStatus.caller = message.caller;
        currentStatus.callUniqueId = message.callUniqueId;
        currentStatus.queueCallTimestamp = new Date();
        break;

      case "DisposeCall":
        currentStatus.agentStatus = "Waiting for Call";
        currentStatus.queueName = "";
        currentStatus.caller = "";
        currentStatus.callUniqueId = "";
        break;

      case "BreakRequested":
        currentStatus.waitingForBreak = true;
        break;

      case "BreakCancelled":
        currentStatus.waitingForBreak = false;
        break;

      case "BreakStarted":
        currentStatus.agentStatus = "In Break";
        currentStatus.waitingForBreak = false;
        currentStatus.breakTimestamp = new Date();
        break;

      case "BreakEnded":
        currentStatus.agentStatus = "Waiting for Call";
        currentStatus.waitingForBreak = false;
        break;

      case "Connected":
        currentStatus.agentStatus = "Connecting ...";
        currentStatus.device = "";
        currentStatus.deviceStatus = "";
        break;

      case "AgentLogin":
        currentStatus.agentStatus = "Logged In";
        currentStatus.device = message.device;
        currentStatus.deviceStatus = "";
        break;

      case "Disconnected":
        currentStatus.agentStatus = "Disconnected";
        break;

      default:
        // console.log('Unhandled Team Member State reported ... ' + message.event);
        break;
    }

    this.teamMemberStates.next(this.teamMemberStatesCache);
  }

  private processIdCard(message: any) {
    const currentStatus = this.teamMemberStatesCache.find(
      (x) => x.agentId === message.userName
    );
    if (currentStatus !== undefined) {
      currentStatus.name = message.name;
    }
    this.teamMemberStates.next(this.teamMemberStatesCache);
  }

  //#endregion

  //#region signalr methods *** *** *** *** *** *** ***

  whoami(): void {
    this.log("SignalR", "Whoami");
    this.connection.send("Whoami");
  }

  // enableTeamLeadFeatures(flag: boolean) {
  //     this.teamLeadFeatures.next(flag);
  // }

  // setAppState(state: any): void {
  //     this.connectionState.next(state);
  // }

  refreshPhoneState(): void {
    this.log("SignalR", "RefreshPhoneState");
    this.connection.send("RefreshPhoneState");
  }

  askId(agentId: string) {
    this.log("SignalR", "AskId");
    this.connection.send("AskId", agentId);
  }

  // chat
  sendChatMessage(message: ChatMessage): void {
    this.log("SignalR", "SendMessage");
    this.connection.send("SendMessage", message);
  }

  sendGroupChatMessage(message: ChatMessage): void {
    this.log("SignalR", "SendToGroup");
    this.connection.send("SendToGroup", message);
  }

  // user actions
  hold(channel: string): void {
    this.log("SignalR", "Hold");
    this.connection.send("Hold", channel);
  }

  resume(channel: string): void {
    this.log("SignalR", "Resume");
    this.connection.send("Resume", channel);
  }

  askBreak() {
    this.log("SignalR", "AskBreak");
    this.connection.send(
      "AskBreak",
      this.taskCache !== null && this.taskCache !== undefined
    );
  }

  askBreak2(btCode: number, reason: string) {
    this.log("SignalR", "AskBreak2");
    this.connection.send("AskBreak2", btCode, reason);
  }

  cancelBreak() {
    this.log("SignalR", "CancelBreak");
    this.connection.send("CancelBreak");
  }

  exitBreak() {
    this.log("SignalR", "ExitBreak");
    this.connection.send("ExitBreak");
  }

  call(trunk: string, cli: string, callid: string): void {
    this.log("SignalR", "Call");
    this.connection.send("Call", trunk, cli, callid);
  }

  hangupCall(channel: string): void {
    this.log("SignalR", "Hangup");
    this.connection.send("Hangup", channel);
  }

  conference(channels: string[]): void {
    this.log("SignalR", "Conference");
    this.connection.send("Conference", channels);
  }

  dispose(): void {
    this.log("SignalR", "DisposeCall");
    this.connection.send("DisposeCall");
  }

  getAgentInfo(): void {
    this.log("SignalR", "AgentInfo");
    this.connection.send("AgentInfo");
  }

  //#endregion

  //#region web api methods *** *** *** *** *** *** ***

  IsAgentAuthenticated() {
    this.log("Api", "IsAgentAuthenticated2");
    return this.remote.get("/api/Account/IsAgentAuthenticated2", {});
  }

  IsOnline() {
    this.log("Api", "IsAgentOnline");
    return this.remote.get("/api/Account/IsAgentOnline", {});
  }

  RemoteLogout() {
    this.log("Api", "LogoutAgentActiveSession");
    return this.remote.post("/api/Account/LogoutAgentActiveSession", {});
  }

  ForceRemoteLogout() {
    this.log("Api", "ForceLogoutAgentActiveSession");
    return this.remote.post("/api/Account/ForceLogoutAgentActiveSession", {});
  }

  IsPhoneMapped() {
    this.log("Api", "IsPhoneMapped");
    return this.remote.get("/api/Account/IsPhoneMapped", {});
  }

  mapPhone(param: DeviceMapParameters) {
    this.log("Api", "AgentLogin");
    return this.remote.post("/api/Devices/AgentLogin", param);
  }

  unassignPhone() {
    this.log("Api", "UnassignPhone");
    return this.remote.post("/api/Devices/UnassignPhone", {});
  }

  endcall(param: EndCall) {
    this.log("Api", "HangupCall");
    return this.remote.post("/api/Call/HangupCall", param);
  }

  calldispositions(param: Calldispositions) {
    this.log("Api", "CallDispositions");
    return this.remote.post("/api/Call/CallDispositions", param);
  }

  getAgents() {
    this.log("Api", "GetTeamMembers");
    return this.remote.get("/api/Agents/GetTeamMembers");
  }

  //#endregion
}
