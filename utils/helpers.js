const settings = require('../config/settings');

function createFooter() {
    return `✨ _Disponsori oleh: ${settings.SPONSOR}_`;
}

function createBotSignature() {
    return `👤 _Created by: ${settings.CREATOR}_\n🔗 _GitHub: ${settings.GITHUB}_`;
}

function formatNumber(jid) {
    return jid.split('@')[0];
}

module.exports = { createFooter, createBotSignature, formatNumber };