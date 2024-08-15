import { time } from "./util.js";

const urls = {
    "glitch-usa": "/api/webhooks/1266391633297936436/y3LFfxCqMqp0FCwxJ65iH4iZn_LFNuJI0PQqGzEZ-hzq070MD9RjnG4F2NH4GH3R0F98",
    "development": "/api/webhooks/1266391955898892413/jyxmwKPy5Z9SlyY60_dDAm_6GSTX2LQ-fxvCtV-ssOdNxmqaLIBPUzdj5SQirZkZ57pb"
};

let lastSend = 0;

const queue = [];
const selectedPath = urls[Bun.env.LOG_NAME] || urls.development;
export const logName = selectedPath === urls["development"] ? "development." : "";

function send(data) {
    fetch("https://discordapp.com" + selectedPath, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            content: data.trim()
        })
    }).catch(console.error);
}

function publish(force) {
    let output = "";

    if (queue.length < 3 && Date.now() - lastSend < 10000 && !force) {
        return;
    }

    lastSend = Date.now();

    while (queue.length > 0) {
        if (output + "\n" + queue[0] > 2000) {
            send(output);
            return;
        }

        output += "\n" + queue.shift();
    }

    send(output);
}

function internalLog(data, force) {
    data = data + "";
    data = data.replace("@", "🤓");
    data = data.trim();

    if (data.length > 2000) {
        while (data.length) {
            send(data.slice(0, 2000).trim());
            data = data.slice(2000).trim();
        }

        return;
    }

    queue.push(data);

    if (force) {
        publish(true);
    }
}

setInterval(publish, 5000);

export default function logToWebhook(...args) {
    args.unshift(`[${time()}]`);
    console.log(...args);
    internalLog(args.join(" "), false);
}