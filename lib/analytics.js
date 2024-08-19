import fs from "node:fs";

const hardwareValidate = {
    gl: v => {
        if (v !== 1 && v !== 0) {
            throw new Error("hardware.gl must be a boolean in numeric form");
        }

        return v === 1;
    },
    gl2: v => {
        if (v !== 1 && v !== 0) {
            throw new Error("hardware.gl2 must be a boolean in numeric form");
        }

        return v === 1;
    },
    minCores: v => {
        if (!Number.isInteger(v) || v < 0) {
            throw new Error("hardware.minCores must be a non-negative integer");
        }

        return v;
    },
    minMem: v => {
        if (!Number.isInteger(v) || v < 0 || v > 8) {
            throw new Error("hardware.minMem must be an integer between 0 and 8");
        }

        return v;
    },
    gpu: v => {
        if (typeof v !== "string") {
            throw new Error("hardware.gpu must be a string");
        }

        return v;
    },
    os: v => {
        if (typeof v !== "string" || !["Windows", "Mac OS", "iOS", "Android", "Linux", "Unix", "Unknown"].includes(v)) {
            throw new Error("hardware.os must be a string in the list of known operating systems");
        }

        return v;
    },
    bench: v => {
        if (!Number.isInteger(v) || v < 0 || v > 4096) {
            throw new Error("hardware.bench must be an integer between 0 and 1024");
        }

        return v;
    }
};

const validate = {
    screen: v => {
        if (typeof v !== "string" || !/^\d+x\d+$/.test(v)) {
            throw new Error("screen must be a string in the format 'widthxheight'");
        }

        return v;
    },
    hardware: v => {
        if (typeof v !== "object") {
            throw new Error("hardware must be an object");
        }

        for (const key in hardwareValidate) {
            if (!(key in v)) {
                throw new Error(`hardware must have a property '${key}'`);
            }

            v[key] = hardwareValidate[key](v[key]);
        }

        return v;
    },
    browser: v => {
        if (typeof v !== "object") {
            throw new Error("browser must be an object");
        }

        if (!("name" in v) || typeof v.name !== "string") {
            throw new Error("browser must have a property 'name'");
        }

        if (!("version" in v) || typeof v.version !== "number") {
            throw new Error("browser must have a property 'version'");
        }

        return v;
    },
    locale: v => {
        if (typeof v !== "string") {
            throw new Error("locale must be a string");
        }

        return Intl.getCanonicalLocales(v)[0];
    },
    tzOff: v => {
        if (!Number.isInteger(v)) {
            throw new Error("timezoneOffset must be an integer");
        }

        return v;
    },
    dst: v => {
        if (v !== 0 && v !== 1) {
            throw new Error("daylightSavings must be a boolean in numeric form");
        }

        return v === 1;
    },
    isMobile: v => {
        if (v !== 0 && v !== 1) {
            throw new Error("isMobile must be a boolean in numeric form");
        }

        return v === 1;
    }
};

export class AnalyticsEntry {
    /**
     * Decode the analytics URL parameter and create an AnalyticsEntry object
     * @param {string} base64String Base64 encoded string (btoa) of a JSON object
     * @returns {AnalyticsEntry}
     * @throws {Error} If the JSON object is missing required properties or has invalid values
     */
    static fromBase64(base64String) {
        const decoded = atob(base64String);
        const json = JSON.parse(decoded);

        for (const key in validate) {
            if (!(key in json)) {
                throw new Error(`Missing required property '${key}'`);
            }

            json[key] = validate[key](json[key]);
        }

        const entry = new AnalyticsEntry();
        entry.screen = json.screen;

        entry.supports = {
            gl: json.hardware.gl,
            gl2: json.hardware.gl2
        };

        entry.hardware = {
            minCores: json.hardware.minCores,
            minMemory: json.hardware.minMem,
            gpu: json.hardware.gpu,
            os: json.hardware.os,
            benchmark: json.hardware.bench
        };

        entry.browser = json.browser.name + "@" + json.browser.version;
        entry.locale = json.locale;
        entry.timezoneOffset = json.tzOff;
        entry.daylightSavings = json.dst;
        entry.isMobile = json.isMobile;

        return entry;
    }

    #entryStart = 0;
    #type = 0;

    constructor() {
        this.screen = "0x0";
        this.supports = {
            gl: false,
            gl2: false
        };

        this.hardware = {
            minCores: 1,
            minMemory: 0,
            gpu: "Other",
            os: "Other",
            benchmark: 0
        };

        this.browser = "Other@0";
        this.locale = "en-US";
        this.timezoneOffset = 0;
        this.daylightSavings = false;
        this.isMobile = false;
        this.time = 0;
        this.#entryStart = performance.now();

        /** @type {{biome:number,gamemode:string}|{biome:number,gamemode:string,modded:boolean,private:boolean}} */
        this.data = {};
    }

    define(type, data) {
        this.#type = type;
        this.typeData = data;
    }

    end() {
        this.time = +((performance.now() - this.#entryStart) / 60_000).toFixed(3);

        if (this.time >= 5_000 && analytics[this.#type]) {
            analytics[this.#type].push(this);
        }
    }
}

// Make sure the file exists
if (!fs.existsSync("analytics.json")) {
    Bun.write("analytics.json", Bun.gzipSync(`{"unknown":[],"lobby":[],"client":[]}`));
}

export let analytics = {};

async function read() {
    const file = Bun.file("analytics.json");
    const buffer = await file.arrayBuffer();

    if (buffer.byteLength === 0) {
        return;
    }

    const unzip = Bun.gunzipSync(buffer);
    const text = new TextDecoder().decode(unzip);

    analytics = JSON.parse(text);
}

async function write() {
    return await Bun.write("analytics.json", Bun.gzipSync(JSON.stringify(analytics)));
}

read();
setInterval(write, 10_000);