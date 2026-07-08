const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const express = require('express');
const QRCode = require('qrcode');
const path = require('path'); 

const app = express();
let currentQR = null; 

// ==========================================
// SETUP WEB SERVER UNTUK SCAN QR
// ==========================================
app.get('/', async (req, res) => {
    if (currentQR) {
        const qrImage = await QRCode.toDataURL(currentQR);
        res.send(`
            <html>
                <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family: Arial;">
                    <h2>📱 Scan QR Code di Bawah Ini</h2>
                    <img src="${qrImage}" alt="QR Code" style="width: 300px; height: 300px;" />
                    <p style="color: gray;">Buka WhatsApp > Perangkat Tertaut > Tautkan Perangkat</p>
                </body>
            </html>
        `);
    } else {
        res.send('<h2>✅ Bot sudah terhubung atau sedang memproses...</h2><p>Refresh halaman ini jika QR belum muncul.</p>');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Web QR Scanner berjalan di port ${PORT}`);
});

// ==========================================
// SETUP BOT WHATSAPP
// ==========================================
async function startBot() {
    // Gunakan absolute path untuk folder session
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'session'));
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true, 
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = qr; 
            console.log('📱 QR Code baru tersedia. Buka browser untuk scan!');
        }

        if (connection === 'open') {
            console.log('✅ Bot berhasil online dan terhubung!');
            currentQR = null; 
        }

        if (connection === 'close') {
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (statusCode === DisconnectReason.loggedOut) {
                console.log('❌ Perangkat logout, hapus folder "session" dan restart.');
                process.exit();
            } else {
                console.log('🔄 Koneksi terputus, mencoba menyambung ulang dalam 5 detik...');
                // Beri delay agar tidak spam reconnect jika server sedang down
                setTimeout(() => startBot(), 5000); 
            }
        }
    });

    // ==========================================
    // FITUR WELCOME & LEAVE GRUP
    // ==========================================
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            const groupMetadata = await sock.groupMetadata(anu.id);
            const groupName = groupMetadata.subject || 'Grup';

            if (anu.action === 'add') {
                let welcomeText = `👋 *Selamat Datang!*\n\nHalo `;
                for (let participant of anu.participants) {
                    welcomeText += `@${participant.split('@')[0]} `;
                }
                welcomeText += `, selamat datang di grup *${groupName}*! \n\n📌 *Tata Tertib Singkat:*\nMohon untuk mengubah nama kontak kamu menjadi format *nama_RMED* agar sesama member bisa saling save contact (SV) dengan mudah ya.\n\n🎮 *Gabung Komunitas Discord Kami!*\nYuk merapat ke server Discord kita:\n🔗 https://discord.gg/xPUVCG2mgq\n\n✨ _Disponsori oleh: averanteam.web.id_\n\nSalam hangat dari kami! 🤖`;

                await sock.sendMessage(anu.id, { text: welcomeText, mentions: anu.participants });
            } 
            else if (anu.action === 'remove') {
                let leaveText = `Selamat jalan `;
                for (let participant of anu.participants) {
                    leaveText += `@${participant.split('@')[0]} `;
                }
                leaveText += `\n\nTerima kasih sudah mampir di *${groupName}*. Sampai jumpa! 👋\n\n✨ _Disponsori oleh: averanteam.web.id_`;

                await sock.sendMessage(anu.id, { text: leaveText, mentions: anu.participants });
            }
        } catch (err) {
            console.error('Error handling group update:', err);
        }
    });
}

startBot();