import { stringToU8, u16ToU8, u8ToString, u8ToU16 } from "./lib/util.js";
import Lobby, { validate } from "./lib/Lobby.js";
import logToWebhook from "./lib/webhookLogger.js";
import { getUUIDData, standardGetUUID } from "./lib/uuid.js";

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
const UUID_RATE_LIMITS = {};
const IP_LIMIT = 2;

setInterval(() => {
    for (const ip in UUID_RATE_LIMITS) {
        if (UUID_RATE_LIMITS[ip] > 0) {
            UUID_RATE_LIMITS[ip]--;
        }

        if (UUID_RATE_LIMITS[ip] === 0) {
            delete UUID_RATE_LIMITS[ip];
        }
    }
}, 6E4);

function respondServerfetch(request) {
    const requestIP = server.requestIP(request);

    if (requestIP === null) {
        return new Response("Invalid IP", { status: 403 });
    }

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
        case "/uuid/get": {
            try {
                const ip = requestIP.address;

                if (!ip) {
                    return Response.json({
                        ok: false,
                        error: "Invalid IP"
                    });
                }

                if (UUID_RATE_LIMITS[ip] >= IP_LIMIT) {
                    return Response.json({
                        ok: false,
                        error: "Rate limit exceeded"
                    });
                }

                const searchParams = url.searchParams;
                const existing = searchParams.get("existing");

                if (!existing || (existing !== "false" && existing.length !== 36)) {
                    return Response.json({
                        ok: false,
                        error: "Invalid existing UUID"
                    });
                }

                const data = standardGetUUID(existing, ip);

                if (data.uuid !== existing) {
                    UUID_RATE_LIMITS[ip] = UUID_RATE_LIMITS[ip] ? UUID_RATE_LIMITS[ip] + 1 : 1;
                }

                return Response.json({
                    ok: true,
                    renewed: data.uuid !== existing,
                    ...data
                });

            } catch (e) {
                return Response.json({
                    ok: false,
                    error: "Internal server error"
                });
            }
        };
        case "/ws/lobby": {
            if (server.upgrade(request, {
                data: {
                    address: requestIP.address,
                    internalID: connectionID++,
                    type: SOCKET_TYPE_LOBBY,
                    url: url
                }
            })) {
                return undefined;
            }

            return new Response("Upgrade Required", { status: 400 });
        };
        case "/ws/client": {
            if (server.upgrade(request, {
                data: {
                    address: requestIP.address,
                    internalID: connectionID++,
                    type: SOCKET_TYPE_CLIENT,
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
}

const server = Bun.serve({
    fetch(request) {
        const response = respondServerfetch(request);

        if (response) {
            response.headers.set('Access-Control-Allow-Origin', '*');
            response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        }

        return response;
    },

    websocket: {
        open(socket) {
            socket.binaryType = "arraybuffer";

            switch (socket.data.type) {
                case SOCKET_TYPE_LOBBY:
                    try {
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
                        socket.terminate();
                    }
                    break;
                case SOCKET_TYPE_CLIENT:
                    if (IP_TABLES[socket.data.address] > 2) {
                        console.log("Rate limit exceeded");
                        return socket.terminate();
                    }

                    try {
                        /** @type {URLSearchParams} */
                        const search = socket.data.url.searchParams;

                        const uuid = search.get("uuid");
                        /** @type {string} */
                        const partyURL = search.get("partyURL");
                        const uuidData = getUUIDData(uuid);

                        if (!uuidData || uuidData.expiresAt < new Date() || !Lobby.lobbies[partyURL]) {
                            console.log(uuid, uuidData, partyURL);
                            socket.terminate();
                            return;
                        }

                        IP_TABLES[socket.data.address] = IP_TABLES[socket.data.address] ? IP_TABLES[socket.data.address] + 1 : 1;

                        const lobby = Lobby.lobbies[partyURL];
                        lobby.addClient(socket, uuid, search.get("clientKey") || "");
                        socket.data.lobby = lobby;
                    } catch (e) {
                        socket.terminate();
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
                    if (socket.data.lobby) {
                        try {
                            socket.data.lobby.removeClient(socket.data.clientID);

                            if (IP_TABLES[socket.data.address] > 0) {
                                IP_TABLES[socket.data.address]--;

                                if (IP_TABLES[socket.data.address] === 0) {
                                    delete IP_TABLES[socket.data.address];
                                }
                            }
                        } catch (e) { }
                    }
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
                case SOCKET_TYPE_CLIENT: {
                    if (!socket.data.lobby) {
                        return;
                    }

                    /** @type {Lobby} */
                    const lobby = socket.data.lobby;

                    try {
                        const message = new Uint8Array(data);

                        if (message.length === 0 || message.length > 1024) {
                            return;
                        }

                        lobby.ownerSocket.send(new Uint8Array([0x01, ...u16ToU8(socket.data.clientID), ...message]));
                    } catch (e) { }
                } break;
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