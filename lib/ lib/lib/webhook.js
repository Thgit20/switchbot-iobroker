const express = require("express");

module.exports = function (adapter) {
    const app = express();
    app.use(express.json());

    app.post("/hook", async (req, res) => {
        const ctx = req.body.context;
        if (!ctx) return res.sendStatus(200);

        const id = ctx.deviceMac;

        if (ctx.powerState) {
            await adapter.setStateAsync(
                `${id}.power`,
                ctx.powerState === "ON",
                true
            );
        }

        if (ctx.slidePosition !== undefined) {
            await adapter.setStateAsync(
                `${id}.position`,
                ctx.slidePosition,
                true
            );
        }

        res.sendStatus(200);
    });

    app.listen(3000, () => {
        adapter.log.info("Webhook läuft auf Port 3000");
    });
};
