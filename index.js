const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const io = require("socket.io")(server, { pingTimeout: 60000 });
const redisAdapter = require("socket.io-redis");

const { REDIS_URI } = require("./src/configs/keys");

io.adapter(redisAdapter({ host: REDIS_URI, port: 6379 }));

require("./src/socket")(io);

// port setting
const PORT = process.env.PORT || 5000;
server.listen(PORT);
