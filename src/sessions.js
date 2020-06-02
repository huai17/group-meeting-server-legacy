const crypto = require("crypto");
const redis = require("redis");

const { REDIS_URI } = require("./configs/keys");

const client = redis.createClient({ host: REDIS_URI, port: 6379 });

const { promisify } = require("util");
const hset = promisify(client.hset).bind(client);
const hget = promisify(client.hget).bind(client);
const hdel = promisify(client.hdel).bind(client);
const hgetall = promisify(client.hgetall).bind(client);
const del = promisify(client.del).bind(client);
const exists = promisify(client.exists).bind(client);
const keys = promisify(client.keys).bind(client);

function RoomSession(options) {
  this.getRoomKeys = async () => {
    return await keys("room:*");
  };

  this.getTokenKeys = async () => {
    return await keys("token:*");
  };

  this.getMemberKeys = async () => {
    return await keys("member:*");
  };

  this.getRoom = async (roomId) => {
    const room = await hgetall(`room:${roomId}`);
    room.tokens = await hgetall(`token:${roomId}`);
    room.members = await hgetall(`member:${roomId}`);
    return room;
  };

  this.getToken = async (roomId) => {
    return await hgetall(`token:${roomId}`);
  };

  this.getMember = async (roomId) => {
    return await hgetall(`member:${roomId}`);
  };

  this.createRoom = async ({
    socketId,
    mediaPipelineId,
    compositeId,
    numberOfMembers = 10,
  }) => {
    let roomId = "";
    do {
      roomId = crypto.randomBytes(16).toString("base64").replace(/=/g, "");
    } while (await exists(`room:${roomId}`));

    await hset(
      `room:${roomId}`,
      "id",
      roomId,
      "masterId",
      socketId,
      "mediaPipelineId",
      mediaPipelineId,
      "compositeId",
      compositeId
    );

    const room = await hgetall(`room:${roomId}`);

    const _tokens = [];
    for (let i = 0; i < numberOfMembers; i++) {
      const token = Buffer.from(`${roomId}#${i}`)
        .toString("base64")
        .replace(/=/g, "");
      _tokens.push(token, token);
    }
    _tokens.push("length", numberOfMembers);

    await hset(`token:${roomId}`, ..._tokens);

    room.tokens = await hgetall(`token:${roomId}`);
    room.members = null;

    if (options && options.mode === "debug")
      console.log(`Create room: ${roomId}`);

    return room;
  };

  this.releaseRoom = async (roomId) => {
    const room = await hgetall(`room:${roomId}`);
    if (!room) return null;
    room.tokens = await hgetall(`token:${roomId}`);
    room.members = await hgetall(`member:${roomId}`);
    await del(`room:${roomId}`);
    await del(`token:${roomId}`);
    await del(`member:${roomId}`);

    if (options && options.mode === "debug")
      console.log(`Release room: ${roomId}`);
    return room;
  };

  this.joinRoom = async ({
    name,
    token,
    socketId,
    roomId,
    webRtcEndpointId,
    hubPortId,
  }) => {
    const room = await hgetall(`room:${roomId}`);
    if (!room) throw new Error("Invalid romm ID");
    room.tokens = await hgetall(`token:${roomId}`);
    room.members = await hgetall(`member:${roomId}`);
    if ((await hget(`token:${roomId}`, token)) !== token)
      throw new Error("Invalid token");
    await hset(`token:${roomId}`, token, socketId);
    await hset(
      `member:${roomId}`,
      socketId,
      JSON.stringify({
        id: socketId,
        name,
        token,
        roomId,
        webRtcEndpointId,
        hubPortId,
      })
    );

    if (options && options.mode === "debug")
      console.log(
        `Client: ${socketId} join room: ${roomId} with token: ${token}`
      );
    return JSON.parse(await hget(`member:${roomId}`, socketId));
  };

  this.leaveRoom = async ({ roomId, socketId }) => {
    const _member = await hget(`member:${roomId}`, socketId);
    const member = _member ? JSON.parse(_member) : null;
    if (!member) return null;

    await hdel(`member:${roomId}`, socketId);
    await hdel(`token:${roomId}`, member.token);

    if (options && options.mode === "debug")
      console.log(`Client: ${socketId} leave room: ${roomId}`);
    return member;
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
