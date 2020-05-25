const crypto = require("crypto");

function RoomSession(options) {
  this._rooms = {};

  this.getRooms = function () {
    return this._rooms;
  };

  this.getRoom = function (id) {
    return this._rooms[id];
  };

  this.createRoom = function ({
    socketId,
    mediaPipelineId,
    compositeId,
    numberOfMembers = 10,
  }) {
    let roomId = "";
    do {
      roomId = crypto.randomBytes(16).toString("base64").replace(/=/g, "");
    } while (this._rooms[roomId]);
    const tokens = {};
    for (let i = 0; i < numberOfMembers; i++) {
      const token = Buffer.from(`${roomId}#${i}`)
        .toString("base64")
        .replace(/=/g, "");
      tokens[token] = token;
    }
    tokens.length = numberOfMembers;
    const newRoom = {
      id: roomId,
      masterId: socketId,
      mediaPipelineId,
      compositeId,
      tokens,
      members: {},
    };
    this._rooms[roomId] = newRoom;

    if (options && options.mode === "debug")
      console.log(`Create room: ${roomId}`);
    return newRoom;
  };

  this.releaseRoom = function (roomId) {
    const room = this._rooms[roomId];
    if (!room) return null;
    const temp = {
      id: roomId,
      masterId: room.masterId,
      mediaPipelineId: room.mediaPipelineId,
      compositeId: room.compositeId,
      members: { ...room.members },
    };
    delete this._rooms[roomId];

    if (options && options.mode === "debug")
      console.log(`Release room: ${roomId}`);
    return temp;
  };

  this.joinRoom = function ({
    name,
    token,
    socketId,
    roomId,
    webRtcEndpointId,
    hubPortId,
  }) {
    const room = this._rooms[roomId];
    if (!room) throw new Error("Invalid romm ID");
    if (room.tokens[token] !== token) throw new Error("Invalid token");
    room.tokens[token] = socketId;
    room.members[socketId] = {
      id: socketId,
      name,
      token,
      roomId,
      webRtcEndpointId,
      hubPortId,
    };

    if (options && options.mode === "debug")
      console.log(
        `Client: ${socketId} join room: ${roomId} with token: ${token}`
      );
    return room.members[socketId];
  };

  this.leaveRoom = function ({ roomId, socketId }) {
    const room = this._rooms[roomId];
    if (!room) return null;
    const member = room.members[socketId];
    if (!member) return null;
    const temp = { ...member };

    delete room.members[socketId];
    delete room.tokens[temp.token];

    if (options && options.mode === "debug")
      console.log(`Client: ${socketId} leave room: ${roomId}`);
    return temp;
  };
}

function ClientSession(options) {
  this._clients = {};

  this.getClients = function () {
    return this._clients;
  };

  this.getClient = function (socketId) {
    return this._clients[socketId];
  };

  this.register = function ({
    socketId,
    roomId,
    token,
    name,
    webRtcEndpoint,
    hubPort,
  }) {
    const newClient = {
      id: socketId,
      roomId,
      token,
      name,
      webRtcEndpoint,
      hubPort,
    };
    this._clients[socketId] = newClient;

    if (options && options.mode === "debug")
      console.log(`Register client: ${socketId} to room: ${roomId}`);
    return newClient;
  };

  this.unregister = function (socketId) {
    const client = this._clients[socketId];
    if (!client) return null;
    const temp = {
      id: socketId,
      roomId: client.roomId,
      token: client.token,
      name: client.name,
    };
    if (client.webRtcEndpoint) client.webRtcEndpoint.release();
    if (client.hubPort) client.hubPort.release();
    delete this._clients[socketId];

    if (options && options.mode === "debug")
      console.log(`Unregister client: ${socketId} from room: ${temp.roomId}`);
    return temp;
  };
}

module.exports = { RoomSession, ClientSession };
