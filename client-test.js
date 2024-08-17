import { stringToU8, u8ToString } from "./lib/util.js";

const socket = new WebSocket("ws://localhost:80/ws/lobby?gameName=Bun%20Test&isModded=no&isPrivate=no&gamemode=maze&biome=2&secretKey=29e4b5febd6c2f326dee890e1f71991ea4c7850bfa09a14a&directConnect=::1,Development Server,-4");
socket.binaryType = "arraybuffer";
socket.onopen = () => {
    console.log("Open");

    socket.send(new Uint8Array([0x02, ...stringToU8("[1, 2, 3, 4]")]));
}

socket.onmessage = e => {
    const message = new Uint8Array(e.data);
    if (message[0] !== 255) {
        return console.log(message);
    }

    console.log(message[1] === 1 ? "Success!" : "Failure:", u8ToString(message, 2));
}

socket.onclose = () => console.log("Closed");