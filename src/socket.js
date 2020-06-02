const {
  getRooms,
  createRoom,
  releaseRoom,
  joinRoom,
  leaveRoom,
  onIceCandidate,
} = require("./groupCall");

module.exports = (io) => {
  io.on("connect", (socket) => {
    // console.log(`Connection ${socket.id} - connect`);

    // error handle
    socket.on("error", (error) => {
      console.error(`Connection ${socket.id} - error:  ${error}`);
      leaveRoom({ socketId: socket.id });
    });

    socket.on("disconnect", () => {
      // console.log(`Connection ${socket.id} - disconnect`);
      leaveRoom({ socketId: socket.id });
    });

    socket.on("message", (message) => {
      // console.log(`Connection ${socket.id} - message: ${message.id}`);

      switch (message.id) {
        case "getRooms":
          getRooms()
            .then((rooms) => {
              socket.send({
                id: "getRoomsResponse",
                response: "success",
                rooms,
              });
            })
            .catch((error) => {
              socket.send({
                id: "getRoomsResponse",
                response: "fail",
                error,
              });
            });
          break;
        case "createRoom":
          // TODO: who can create room
          createRoom({ socketId: socket.id, numberOfMembers: 10 })
            .then((room) => {
              socket.send({
                id: "createRoomResponse",
                response: "success",
                room,
              });
            })
            .catch((error) => {
              socket.send({
                id: "createRoomResponse",
                response: "fail",
                error,
              });
            });
          break;

        case "releaseRoom":
          releaseRoom({ roomId: message.roomId, io })
            .then(() => {
              socket.send({
                id: "releaseRoomResponse",
                response: "success",
              });
            })
            .catch((error) => {
              socket.send({
                id: "releaseRoomResponse",
                response: "fail",
                error,
              });
            });
          break;

        case "joinRoom":
          joinRoom({
            socket,
            name: message.name,
            token: message.token,
            sdpOffer: message.sdpOffer,
          })
            .then((sdpAnswer) => {
              socket.send({
                id: "joinRoomResponse",
                response: "success",
                sdpAnswer,
              });
            })
            .catch((error) => {
              socket.send({
                id: "joinRoomResponse",
                response: "fail",
                error,
              });
            });
          break;

        case "leaveRoom":
          leaveRoom({ roomId: message.roomId, socketId: socket.id })
            .then(() => {
              socket.send({
                id: "leaveRoomResponse",
                response: "success",
              });
            })
            .catch((error) => {
              socket.send({
                id: "leaveRoomResponse",
                response: "fail",
                error,
              });
            });
          break;

        case "onIceCandidate":
          onIceCandidate({ socketId: socket.id, candidate: message.candidate });
          break;

        default:
          socket.send({
            id: "error",
            message: `Invalid message: ${message.id}. `,
          });
          break;
      }
    });
  });
};
