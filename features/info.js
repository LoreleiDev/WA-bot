const fs = require('fs');
const path = require('path');
const settings = require('../config/settings');

async function handlePing(sock, from, message, isBotActive) {
    const botImagePath = path.join(__dirname, '../bronya.jpg');

    // Tentukan status berdasarkan isBotActive
    const statusText = isBotActive
        ? "✅ *Status:* Online"
        : "⏸️ *Status:* Paused / Offline";

    const caption = `🤖 *${settings.BOT_NAME}*

${statusText}
⚡ *Response Time:* ${(Date.now() - message.messageTimestamp * 1000).toFixed(0)}ms

━━━━━━━━━━━━━━━━━━━━━

👨‍💻 *Creator:* ${settings.CREATOR}
🔗 *GitHub:* ${settings.GITHUB}
💬 *Discord:* ${settings.DISCORD}

${createFooter()}`;

    if (fs.existsSync(botImagePath)) {
        await sock.sendMessage(from, {
            image: fs.readFileSync(botImagePath),
            caption: caption
        }, { quoted: message });
    } else {
        await sock.sendMessage(from, { text: caption }, { quoted: message });
    }
}

async function handleList(sock, from, message) {
    const listText = `🤖 *${settings.BOT_NAME} - Command List*

╭─────────────────────
│ 🎨 *STIKER & MEDIA*
├─────────────────────
│ • *.s* atau *.stiker*
│   └ Buat stiker dari gambar/video
│   └ Video maksimal 15 detik
│
╭─────────────────────
│ 👁️ *VIEW ONCE EXTRACTOR*
├─────────────────────
│ • *.nvo*
│   └ Extract pesan view once (sekali lihat)
│   └ Wajib reply pesan view once dulu
│   └ Support: image, video, audio, doc, sticker
│
╭─────────────────────
│ 📝 *CATATAN PRIBADI*
├─────────────────────
│ • *.catat <judul>*
│   └ Simpan pesan yang di-reply
│   └ Wajib menyertakan judul
│   └ Contoh: .catat resep masakan
│
│ • *.catatan*
│   └ Lihat daftar semua judul catatanmu
│
│ • *.catatan <judul>*
│   └ Lihat isi catatan spesifik
│   └ Contoh: .catatan resep masakan
│
╭─────────────────────
│ 📢 *GRUP & INTERAKSI*
├─────────────────────
│ • *.tagall*
│   └ Mention semua member (Grup Only)
│   └ Wajib reply pesan sebagai "tumbal"
│
│ • *.me*
│   └ Lihat info profilmu
│
│ • *.profile @user*
│   └ Lihat info profil user lain
│
╭─────────────────────
│ 📡 *STATUS BOT*
├─────────────────────
│ • *.p* atau *.ping*
│   └ Cek status bot & response time
│
│ • *.list*
│   └ Tampilkan daftar command ini
│
╰─────────────────────

✨ ${createFooter()}
👤 _Created by: ${settings.CREATOR}_
🔗 _GitHub: ${settings.GITHUB}_`;

    await sock.sendMessage(from, { text: listText }, { quoted: message });
}

function createFooter() {
    return `_Disponsori oleh: ${settings.SPONSOR}_`;
}

module.exports = { handlePing, handleList };