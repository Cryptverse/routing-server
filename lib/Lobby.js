import { stringToU8, u16ToU8, u8ToU16 } from "./util.js";
import logToWebhook, { logName } from "./webhookLogger.js";

const TRUSTED = {};

for (const key in Bun.env) {
    if (key.startsWith("TRUSTED_")) {
        const value = Bun.env[key];

        if (value.length !== 48) {
            console.warn(`Invalid TRUSTED key ${key}, must be 48 characters long. Skipping...`);
            continue;
        }

        TRUSTED[key.slice(8)] = value;
    }
}

const ADMINS = {};

for (const key in Bun.env) {
    if (key.startsWith("ADMIN_")) {
        ADMINS[Bun.env[key]] = key.slice(6);
    }
}

export const validate = {
    gameName: v => {
        if (typeof v !== "string" || v.length < 1 || v.length > 32) {
            throw new Error("gameName must be a string between 1 and 32 characters long");
        }

        return v;
    },
    isModded: v => {
        if (v !== "yes" && v !== "no") {
            throw new Error("isModded must be either 'yes' or 'no'");
        }

        return v === "yes";
    },
    isPrivate: v => {
        if (v !== "yes" && v !== "no") {
            throw new Error("isPrivate must be either 'yes' or 'no'");
        }

        return v === "yes";
    },
    secretKey: v => {
        if (typeof v !== "string" || (v.length !== 48 && v.length !== 0)) {
            throw new Error("secretKey must be a string of 48 characters or empty");
        }

        return v;
    },
    gamemode: v => {
        if (!["ffa", "tdm", "waves", "line", "maze"].includes(v)) {
            throw new Error("gamemode must be a valid gamemode string");
        }

        return v;
    },
    biome: v => {
        v = +v;
        if (isNaN(v) || v < 0 || v > 7) {
            throw new Error("biome must be a number between 0 and 7");
        }

        return v;
    },
    directConnect: v => {
        if (v == null || !v) {
            return null;
        }

        const split = v.split(",");

        if (split.length !== 2) {
            throw new Error("directConnect must be a string in the format 'address,timeZone'");
        }

        const [address, timeZone] = split;

        if (typeof address !== "string" || address.length < 1 || address.length > 64) {
            throw new Error("address must be a string for a valid connection address between 1 and 64 characters long");
        }

        const timeZoneNumber = +timeZone;
        if (isNaN(timeZoneNumber) || timeZoneNumber < -12 || timeZoneNumber > 14) {
            throw new Error("timeZone must be a number representing the timezone your server is in between -12 and 14");
        }

        return {
            address: address,
            timeZone: timeZoneNumber
        };
    }
};

class IDManager {
    constructor(maxID = 65535) {
        this.ids = new Array(maxID + 1).fill(false);
    }

    next() {
        const index = this.ids.indexOf(false);

        if (index === -1) {
            return -1;
        }

        this.ids[index] = true;
        return index;
    }

    release(id) {
        this.ids[id] = false;
    }
}

export default class Lobby {
    static generatePartyCode() {
        while (true) {
            const code = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(e => e.toString(16).padStart(2, "0")).join("");

            if (!Lobby.lobbies[code]) {
                return code;
            }
        }
    }

    /** @type {Object.<string, Lobby>} */
    static lobbies = {};

    static toJSONResponse() {
        const lobbies = [];

        for (const key in Lobby.lobbies) {
            const lobby = Lobby.lobbies[key];

            if (lobby.isPrivate) {
                continue;
            }

            lobbies.push(lobby.toJSON());
        }

        return lobbies;
    }

    /** @param {WebSocket} ownerSocket @param {string} gameName */
    constructor(ownerSocket, gameName) {
        this.ownerSocket = ownerSocket;
        this.name = validate.gameName(gameName);
        this.partyCode = Lobby.generatePartyCode();

        this.trusted = false;
        this.isModded = false;
        this.isPrivate = false;
        this.secretKey = "";
        this.gamemode = "ffa";
        this.biome = 0;
        this.resources = null;

        this._hasSentMagicPacket = false;

        /** @type {Map<number,WebSocket>} */
        this.clients = new Map();

        /** @type {{address:string,timeZone:number}|null} */
        this.directConnect = null;

        this.idManager = new IDManager(65535);
        this.idManager.ids[0] = true; // Reserved for a "broadcast" call
    }

    log(...args) {
        logToWebhook(`(Lobby: ${this.name})`, ...args);
    }

    /**
     * Define properties about the lobby
     * @param {boolean} isModded If the lobby is modded
     * @param {boolean} isPrivate Will the lobby show up on lists
     * @param {string} secretKey The token that authenticates if it is trusted via env TRUSTED_name=key pairs
     * @param {string} gamemode The gamemode of the lobby
     * @param {number} biome The biome ID of the lobby
     * @returns {Lobby}
     */
    define(isModded, isPrivate, secretKey, gamemode, biome) {
        this.isModded = validate.isModded(isModded);
        this.isPrivate = validate.isPrivate(isPrivate);
        this.secretKey = validate.secretKey(secretKey);
        this.gamemode = validate.gamemode(gamemode);
        this.biome = validate.biome(biome);

        for (const key in TRUSTED) {
            if (TRUSTED[key] === this.secretKey) {
                this.trusted = key;
                break;
            }
        }

        return this;
    }

    setDirectConnect(address, timeZone) {
        if (this.isPrivate) {
            throw new Error("Cannot set direct connect on a private lobby");
        }

        if (!this.trusted) {
            throw new Error("Cannot set direct connect on an untrusted lobby");
        }

        this.directConnect = {
            address: address,
            timeZone: timeZone
        };

        return this;
    }

    begin() {
        Lobby.lobbies[this.partyCode] = this;

        let logString = "Created & Defined ";

        if (this.trusted) {
            logString += "a trusted ";
        } else {
            logString += "an untrusted ";
        }

        if (this.isPrivate) {
            logString += "private lobby ";
        } else {
            logString += "public lobby ";
        }

        if (this.trusted) {
            logString += "by " + this.trusted + " ";
        }

        logString += "called " + this.name;

        if (!this.isPrivate) {
            logString += " at " + "https://" + logName + "floof.eparker.dev/#" + this.partyCode + ". Gamemode: " + this.gamemode + ", Biome: " + this.biome;
        }

        if (this.directConnect) {
            logString += " with direct connect in " + this.directConnect.timeZone + " timezone";
        }

        this.log(logString);
    }

    destroy() {
        delete Lobby.lobbies[this.partyCode];

        this.clients.forEach(client => client.close());

        this.log("Destroyed lobby");
    }

    toJSON() {
        return {
            name: this.name,
            partyCode: this.partyCode,
            trusted: this.trusted,
            isModded: this.isModded,
            isPrivate: this.isPrivate,
            gamemode: this.gamemode,
            biome: this.biome,
            directConnect: this.directConnect
        };
    }

    sendMagic() {
        if (this._hasSentMagicPacket) {
            return;
        }

        this._hasSentMagicPacket = true;

        this.ownerSocket.send(new Uint8Array([255, 1, ...stringToU8(this.partyCode)]));
    }

    /**
     * @param {WebSocket} client
     * @param {string} uuid
     * @param {string} secret
     */
    addClient(client, uuid, secret) {
        client.data.clientID = this.idManager.next();
        this.clients.set(client.data.clientID, client);
        this.ownerSocket.send(new Uint8Array([0x00, ...u16ToU8(client.data.clientID), ADMINS[secret] ? 1 : 0, ...stringToU8(uuid)]));
        this.log(`Client (${client.data.clientID}) joined`, ADMINS[secret] ? `(admin: ${ADMINS[secret]})` : "");
    }

    removeClient(clientID) {
        if (!this.clients.has(clientID)) {
            return;
        }

        const client = this.clients.get(clientID);
        this.clients.delete(clientID);
        this.idManager.release(clientID);
        client.close();
        this.ownerSocket.send(new Uint8Array([0x02, ...u16ToU8(clientID)]));
        this.log(`Client ${clientID} left`);
    }

    pipe(controlledPacket) {
        const clientID = u8ToU16(controlledPacket, 1);
        const message = Uint8Array.from(controlledPacket.slice(3));

        if (clientID === 0) {
            this.clients.forEach(client => client.send(message));
            return;
        }

        if (!this.clients.has(clientID)) {
            return;
        }

        this.clients.get(clientID).send(message);
    }
}