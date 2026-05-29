const axios = require("axios");
const crypto = require("crypto");

class API {
    constructor(config) {
        this.token = config.token;
        this.secret = config.secret;
    }

    headers() {
        const nonce = crypto.randomBytes(16).toString("base64");
        const t = Date.now().toString();

        const sign = crypto
            .createHmac("sha256", this.secret)
            .update(this.token + t + nonce)
            .digest("base64");

        return {
            Authorization: this.token,
            sign,
            nonce,
            t
        };
    }

    getDevices() {
        return axios.get(
            "https://api.switch-bot.com/v1.1/devices",
            { headers: this.headers() }
        );
    }

    status(id) {
        return axios.get(
            `https://api.switch-bot.com/v1.1/devices/${id}/status`,
            { headers: this.headers() }
        );
    }

    command(id, body) {
        return axios.post(
            `https://api.switch-bot.com/v1.1/devices/${id}/commands`,
            body,
            { headers: this.headers() }
        );
    }
}

module.exports = API;
