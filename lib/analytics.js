// IP collected for purposes of resolving basic information.

export class ClientAnalytic {
    /** @type {import("bun").SocketAddress|null} */
    address = null;

    closestTimezone = 0;
    browser = "";
    os = "";
    device = "";

    visitStart = 0;
    visitEnd = 0;

    get visitDuration() {
        return this.visitEnd - this.visitStart;
    }
}

export class LobbyAnalytic {
    /** @type {import("bun").SocketAddress|null} */
    address = null;

    closestTimezone = 0;
    browser = "";
    os = "";
    device = "";

    visitStart = 0;
    visitEnd = 0;

    get visitDuration() {
        return this.visitEnd - this.visitStart;
    }

    gamemode = "";
    biome = "";
    isPrivate = false;
    isModded = false;
}