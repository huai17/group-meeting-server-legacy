const kurento = require("kurento-client");
const { pickBy } = require("lodash");
const { ClientSession, RoomSession } = require("./sessions");

// Modify here the kurento media server address
const { KURENTO_URI } = require("./configs/keys");

let _kurentoClient = null;
const candidatesQueue = {};
const roomSession = new RoomSession();
const clientSession = new ClientSession();

const getKurentoClient = () =>
  new Promise((resolve, reject) => {
    if (_kurentoClient) return resolve(_kurentoClient);
    kurento(KURENTO_URI, (error, kurentoClient) => {
      if (error) return reject(error);
      _kurentoClient = kurentoClient;
      return resolve(_kurentoClient);
    });
  });

const getMediaObjectById = (id) =>
  new Promise(async (resolve, reject) => {
    try {
      const kurentoClient = await getKurentoClient();
      kurentoClient.getMediaobjectById(id, (error, mediaObject) => {
        if (error) return reject(error);
        return resolve(mediaObject);
      });
    } catch (error) {
      return reject(error);
    }
  });

const createMediaPipeline = () =>
  new Promise(async (resolve, reject) => {
    try {
      const kurentoClient = await getKurentoClient();
      kurentoClient.create("MediaPipeline", (error, mediaPipeline) => {
        if (error) return reject(error);
        return resolve(mediaPipeline);
      });
    } catch (error) {
      return reject(error);
    }
  });

const createComposite = (mediaPipeline) =>
  new Promise(async (resolve, reject) => {
    try {
      mediaPipeline.create("Composite", (error, composite) => {
        if (error) return reject(error);
        return resolve(composite);
      });
    } catch (error) {
      return reject(error);
    }
  });

const createHubPort = (composite) =>
  new Promise(async (resolve, reject) => {
    try {
      composite.createHubPort((error, hubPort) => {
        if (error) return reject(error);
        resolve(hubPort);
      });
    } catch (error) {
      return reject(error);
    }
  });

const createWebRtcEndPoint = (mediaPipeline) =>
  new Promise(async (resolve, reject) => {
    try {
      mediaPipeline.create("WebRtcEndpoint", (error, webRtcEndpoint) => {
        if (error) return reject(error);
        resolve(webRtcEndpoint);
      });
    } catch (error) {
      return reject(error);
    }
  });

const getRoom = (roomId) =>
  new Promise(async (resolve, reject) => {
    let room = null;
    try {
      room = await roomSession.getRoom(roomId);
      if (!room) return resolve(null);
      room.mediaPipeline = await getMediaObjectById(room.mediaPipelineId);
      room.composite = await getMediaObjectById(room.compositeId);
      return resolve(room);
    } catch (error) {
      if (room && room.composite) room.composite.release();
      if (room && room.mediaPipeline) room.mediaPipeline.release();
      if (room && room.members) {
        for (let socketId in room.members) {
          io.to(socketId).send({ id: "stopCommunication" });
        }
      }
      await roomSession.releaseRoom(roomId);
      return reject(error);
    }
  });

const getRooms = () =>
  new Promise(async (resolve, reject) => {
    try {
      const keys = await roomSession.getRoomKeys();
      return resolve(
        await Promise.all(
          keys.map(async (key) => {
            const room = await roomSession.getRoom(key.split(":")[1]);

            return pickBy(
              {
                ...room,
                mediaPipelineId: undefined,
                compositeId: undefined,
              },
              (e) => e !== undefined
            );
          })
        )
      );
    } catch (error) {
      return reject(error);
    }
  });

const createRoom = ({ socketId, numberOfMembers = 10 }) =>
  new Promise(async (resolve, reject) => {
    let mediaPipeline = null;
    let composite = null;
    try {
      mediaPipeline = await createMediaPipeline();
      composite = await createComposite(mediaPipeline);
      const room = await roomSession.createRoom({
        socketId,
        mediaPipelineId: mediaPipeline.id,
        compositeId: composite.id,
        numberOfMembers,
      });
      return resolve(
        pickBy(
          {
            ...room,
            mediaPipelineId: undefined,
            compositeId: undefined,
          },
          (e) => e !== undefined
        )
      );
    } catch (error) {
      if (composite) composite.release();
      if (mediaPipeline) mediaPipeline.release();
      return reject(error);
    }
  });

const releaseRoom = ({ roomId, io }) =>
  new Promise(async (resolve, reject) => {
    try {
      const room = await getRoom(roomId);
      if (!room) return resolve();
      if (room.composite) room.composite.release();
      if (room.mediaPipeline) room.mediaPipeline.release();

      if (room.members) {
        for (let socketId in room.members) {
          io.to(socketId).send({ id: "stopCommunication" });
        }
      }

      await roomSession.releaseRoom(roomId);
      return resolve();
    } catch (error) {
      reject(error);
    }
  });

const joinRoom = ({ socket, name, token, sdpOffer }) =>
  new Promise(async (resolve, reject) => {
    let webRtcEndpoint = null;
    let hubPort = null;
    let roomId = null;

    try {
      const parsedToken = Buffer.from(token, "base64")
        .toString("ascii")
        .split("#");
      roomId = parsedToken[0];
      const room = await getRoom(roomId);
      if (!room) return reject("Roon not exists.");
      webRtcEndpoint = await createWebRtcEndPoint(room.mediaPipeline);
      if (candidatesQueue[socket.id]) {
        while (candidatesQueue[socket.id].length) {
          const candidate = candidatesQueue[socket.id].shift();
          webRtcEndpoint.addIceCandidate(candidate);
        }
      }
      webRtcEndpoint.on("OnIceCandidate", (event) => {
        const candidate = kurento.getComplexType("IceCandidate")(
          event.candidate
        );
        socket.send({ id: "iceCandidate", candidate });
      });
      hubPort = await createHubPort(room.composite);
      await roomSession.joinRoom({
        name: `${name}#${parsedToken[1]}`,
        token: token,
        socketId: socket.id,
        roomId,
        webRtcEndpointId: webRtcEndpoint.id,
        hubPortId: hubPort.id,
      });
      clientSession.register({
        socketId: socket.id,
        roomId,
        token: token,
        name: `${name}#${parsedToken[1]}`,
        webRtcEndpoint,
        hubPort,
      });

      webRtcEndpoint.connect(hubPort);
      hubPort.connect(webRtcEndpoint);
      webRtcEndpoint.processOffer(sdpOffer, (error, sdpAnswer) => {
        if (error) {
          leaveRoom({ socketId: socket.id, roomId });
          return reject(error);
        }
        resolve(sdpAnswer);
      });
      webRtcEndpoint.gatherCandidates((error) => {
        if (error) return reject(error);
      });
    } catch (error) {
      if (webRtcEndpoint) webRtcEndpoint.release();
      if (hubPort) hubPort.release();
      leaveRoom({ socketId: socket.id, roomId });
      return reject(error);
    }
  });

const leaveRoom = async ({ roomId: _roomId, socketId }) => {
  let roomId = _roomId;
  const client = clientSession.unregister(socketId);
  if (client && client.roomId) roomId = client.roomId;
  if (roomId) await roomSession.leaveRoom({ roomId, socketId });
};

const onIceCandidate = ({ socketId, candidate: _candidate }) => {
  const candidate = kurento.getComplexType("IceCandidate")(_candidate);
  const client = clientSession.getClient(socketId);
  if (client && client.webRtcEndpoint) {
    client.webRtcEndpoint.addIceCandidate(candidate);
  } else {
    if (!candidatesQueue[id]) candidatesQueue[id] = [];
    candidatesQueue[id].push(candidate);
  }
};

module.exports = {
  getRooms,
  createRoom,
  releaseRoom,
  joinRoom,
  leaveRoom,
  onIceCandidate,
};
