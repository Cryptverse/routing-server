import { stringToU8, u8ToString, u8ToU16 } from "./lib/util.js";
import Lobby, { validate } from "./lib/Lobby.js";
import logToWebhook from "./lib/webhookLogger.js";

if (Bun.env.ENV_DONE !== "true") {
    const trustedKey = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(e => e.toString(16).padStart(2, "0")).join("");
    await Bun.write("./.env", `ENV_DONE=false\nTRUSTED_admin=${trustedKey}\nADMIN_admin=devkey\nLOG_NAME=development\nPORT=80\nTLS_DIRECTORY=false`);
    console.warn("Please fill out the .env file with the correct values. Set ENV_DONE to 'true' when done.");
    process.exit();
}

let connectionID = 0;
const SOCKET_TYPE_LOBBY = 0;
const SOCKET_TYPE_CLIENT = 1;

const IP_TABLES = {};

const server = Bun.serve({
    fetch(request) {
        const url = new URL(request.url);
        switch (url.pathname) {
            case "/lobby/list":
                return Response.json(Lobby.toJSONResponse());
            case "/lobby/get": {
                const id = url.searchParams.get("partyURL");

                if (!id) {
                    return Response.json(null);
                }

                const lobby = Lobby.lobbies[id];

                if (!lobby) {
                    return Response.json(null);
                }

                return Response.json(lobby.toJSON());
            };
            case "/lobby/resources": {
                const id = url.searchParams.get("partyURL");

                if (!id) {
                    return Response.json(null);
                }

                const lobby = Lobby.lobbies[id];

                if (!lobby) {
                    return Response.json(null);
                }

                return Response.json(lobby.resources);
            };
            case "/ws/lobby": {
                if (server.upgrade(request, {
                    data: {
                        address: server.requestIP(request),
                        internalID: connectionID++,
                        type: SOCKET_TYPE_LOBBY,
                        url: url
                    }
                })) {
                    return undefined;
                }

                return new Response("Upgrade Required", { status: 400 });
            };
            default:
                return new Response("Page not found", { status: 404 });
        }
    },

    websocket: {
        open(socket) {
            socket.binaryType = "arraybuffer";

            switch (socket.data.type) {
                case SOCKET_TYPE_LOBBY:
                    try {
                        console.log(socket.data.address);
                        /** @type {URLSearchParams} */
                        const search = socket.data.url.searchParams;
                        const lobby = new Lobby(socket, search.get("gameName"));
                        lobby.define(
                            search.get("isModded"),
                            search.get("isPrivate"),
                            search.get("secretKey") || "",
                            search.get("gamemode"),
                            search.get("biome")
                        );

                        if (search.has("directConnect")) {
                            const directConnect = validate.directConnect(search.get("directConnect"));

                            if (directConnect !== null) {
                                lobby.setDirectConnect(directConnect.address, directConnect.modtd, directConnect.timeZone);
                            }
                        }

                        lobby.begin();
                        socket.data.lobby = lobby;
                    } catch (e) {
                        socket.send(new Uint8Array([255, 0, ...stringToU8(e.message)]));
                        socket.close();
                    }
                    break;
                case SOCKET_TYPE_CLIENT:
                    if (IP_TABLES[socket.remoteAddress] > 2) {
                        return socket.terminate();
                    }
                    break;
                default:
                    socket.close();
                    break;
            }
        },

        close(socket) {
            switch (socket.data.type) {
                case SOCKET_TYPE_LOBBY: {
                    if (socket.data.lobby) {
                        socket.data.lobby.destroy();
                    }
                } break;
                case SOCKET_TYPE_CLIENT:
                    break;
            }
        },

        message(socket, data) {
            if (typeof data === "string" || data.byteLength === 0) {
                return;
            }

            switch (socket.data.type) {
                case SOCKET_TYPE_LOBBY: {
                    const message = new Uint8Array(data);

                    if (message.length === 0 || socket.data.lobby === undefined) {
                        return;
                    }

                    /** @type {Lobby} */
                    const lobby = socket.data.lobby;
                    switch (message[0]) {
                        case 0x00:
                            lobby.removeClient(u8ToU16(message, 1));
                            break;
                        case 0x01:
                            lobby.pipe(message);
                            break;
                        case 0x02:
                            try {
                                lobby.resources = JSON.parse(u8ToString(message, 1));
                                lobby.sendMagic();
                            } catch (e) {
                                socket.send(new Uint8Array([255, 0, ...stringToU8("Invalid JSON resources")]));
                            }
                            break;
                    }
                } break;
                case SOCKET_TYPE_CLIENT: {} break;
            }
        }
    },

    port: Bun.env.PORT,
    tls: Bun.env.TLS_DIRECTORY !== "false" ? {
        key: await Bun.read(`${Bun.env.TLS_DIRECTORY}/privkey.pem`),
        cert: await Bun.read(`${Bun.env.TLS_DIRECTORY}/cert.pem`)
    } : undefined
});

logToWebhook("Server started:", server.url.toString());