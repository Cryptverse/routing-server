// Little Endian
export const u16ToU8 = n => [n & 0xFF, n >> 8];
export const u8ToU16 = (u8, o = 0) => u8[o] | u8[o + 1] << 8;

export const stringToU8 = str => {
    const bytes = unescape(encodeURIComponent(str));
    const u8 = new Uint8Array(bytes.length + 1);

    for (let i = 0; i < bytes.length; i++) {
        u8[i] = bytes.charCodeAt(i);
    }

    u8[bytes.length] = 0;

    return u8;
}

export const u8ToString = (u8, o = 0) => {
    let str = "",
        i = o;

    while (u8[i] !== 0 && i < u8.length) {
        str += String.fromCharCode(u8[i]);
        i++;
    }

    return decodeURIComponent(escape(str));
}

export const time = () => {
    const d = new Date();

    // mm:dd:yyyy hh:mm:ss
    const month = (d.getMonth() + 1).toString().padStart(2, "0");
    const day = d.getDate().toString().padStart(2, "0");
    const year = d.getFullYear();
    const hours = d.getHours().toString().padStart(2, "0");
    const minutes = d.getMinutes().toString().padStart(2, "0");
    const seconds = d.getSeconds().toString().padStart(2, "0");

    return `${month}:${day}:${year} ${hours}:${minutes}:${seconds}`;
};