import fs from "node:fs";

const UUIDCacheFile = "uuid_saves.txt";

const UUIDCache = new Map();

async function loadUUIDCache() {
    if (!fs.existsSync(UUIDCacheFile)) return;

    try {
        const file = Bun.file(UUIDCacheFile);
        const data = (await file.text()).trim();
        const lines = data.split("\n").map(line => line.trim()).filter(line => line.length > 0);
        for (const line of lines) {
            const [id, expires, ip] = line.split(" ");
            UUIDCache.set(id, {
                expiresAt: new Date(parseInt(expires)),
                ipaddr: ip
            });
        }
    } catch (error) {
        console.error("Error loading UUID cache:", error);
    }
}

function saveUUIDCache() {
    const stuff = [];

    UUIDCache.forEach((data, id) => {
        stuff.push(`${id} ${data.expiresAt.getTime()} ${data.ipaddr}`);
    });

    try { 
        Bun.write(UUIDCacheFile, stuff.join("\n")).catch(reason=>console.error);
    } catch (error) {
        console.error("Error saving UUID cache:", error);
    }
}

loadUUIDCache();

setInterval(() => {
    const now = new Date();
    UUIDCache.forEach((data, id) => { if (now >= data.expiresAt) UUIDCache.delete(id); });
    saveUUIDCache();
}, 5E3);

export function getUUIDData(id) {
    const data = UUIDCache.get(id);
    if (data == null) return null;
    return {uuid: id, expiresAt: data.expiresAt, ipaddr: data.ipaddr};
}

export function getUUIDDataByIP(ip) {
    const output = [];

    UUIDCache.forEach((data, id) => {
        if (data.ipaddr === ip) {
            output.push(id);
        }
    });

    return output;
}

export function setUUIDData(id, expiresAt, ipaddr) {
    UUIDCache.set(id, {
        expiresAt,
        ipaddr
    });

    saveUUIDCache();
}

export function requestUUID(ip) {
    let id;

    do {
        id = crypto.randomUUID();
    } while (UUIDCache.has(id));

    setUUIDData(id, new Date(Date.now() + 1000 * 60 * 60 * 24), ip);

    return getUUIDData(id);
}

export function renewUUID(id) {
    const data = getUUIDData(id);
    if (!data) return false;
    data.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);
    setUUIDData(id, data.expiresAt, data.ipaddr);
    return true;
}

export function standardGetUUID(existingUUID, ip) {
    const existing = getUUIDData(existingUUID);

    if (existing && existing.expiresAt > new Date() /* && existing.ipaddr === ip */) {
        renewUUID(existing.uuid);
        return getUUIDData(existing.uuid);
    }

    return requestUUID(ip);
}