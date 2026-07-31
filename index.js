const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const { handleCommand } = require('./handlers/commandHandler');
const settings = require('./config/settings');

// Pastikan folder data ada
const dataPath = path.join(__dirname, 'data');
if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath);
    console.log('📁 Folder data created');
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(
        path.join(__dirname, 'session')
    );

    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        syncFullHistory: true,
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', saveCreds);

    // ==========================================
    // KONEKSI & QR CODE
    // ==========================================
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.clear();
            console.log('📱 Scan QR Code berikut menggunakan WhatsApp:\n');
            qrcode.generate(qr, { small: true });
            console.log('\nWhatsApp → Perangkat Tertaut → Tautkan Perangkat');
        }

        if (connection === 'connecting') {
            console.log('🔄 Menghubungkan ke WhatsApp...');
        }

        if (connection === 'open') {
            console.clear();
            console.log(`✅ ${settings.BOT_NAME} berhasil online dan terhubung!`);
            console.log(`👤 Owner: ${settings.OWNER_JID.split('@')[0]}`);
            console.log(`✨ Ready to serve!`);
        }

        if (connection === 'close') {
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (statusCode === DisconnectReason.loggedOut) {
                console.log('❌ Perangkat logout. Hapus folder "session" lalu jalankan ulang.');
                process.exit();
            } else {
                console.log('🔄 Koneksi terputus, reconnect dalam 5 detik...');
                setTimeout(() => startBot(), 5000);
            }
        }
    });

    // ==========================================
    // FITUR WELCOME & LEAVE GRUP
    // ==========================================
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            await new Promise(resolve => setTimeout(resolve, 2000));

            let groupName = 'Grup';
            try {
                const groupMetadata = await sock.groupMetadata(anu.id);
                groupName = groupMetadata.subject || 'Grup';
            } catch (metaError) {
                console.log('⚠️ Tidak bisa akses metadata grup');
            }

            const participants = anu.participants.map(p => {
                if (typeof p === 'string') return p;
                else if (typeof p === 'object' && p !== null) return p.jid || p.id || '';
                return '';
            }).filter(p => p && p.includes('@'));

            if (participants.length === 0) return;

            if (anu.action === 'add') {
                let welcomeText = `👋 *Selamat Datang!*\n\nHalo `;
                for (let participant of participants) {
                    welcomeText += `@${participant.split('@')[0]} `;
                }
                welcomeText += `, selamat datang di grup *${groupName}*! \n\n📌 *Tata Tertib Singkat:*\nMohon untuk mengubah nama kontak kamu menjadi format *nama_RMED* agar sesama member bisa saling save contact (SV) dengan mudah ya.\n\n🎮 *Gabung Komunitas Discord Kami!*\nYuk merapat ke server Discord kita:\n🔗 ${settings.DISCORD}\n\n✨ _Disponsori oleh: ${settings.SPONSOR}_\n\nSalam hangat dari kami! 🤖`;

                await sock.sendMessage(anu.id, { text: welcomeText, mentions: participants });
            }
            else if (anu.action === 'remove') {
                let leaveText = ` Selamat jalan `;
                for (let participant of participants) {
                    leaveText += `@${participant.split('@')[0]} `;
                }
                leaveText += `\n\nTerima kasih sudah mampir di *${groupName}*. Sampai jumpa!\n\n✨ _Disponsori oleh: ${settings.SPONSOR}_`;

                await sock.sendMessage(anu.id, { text: leaveText, mentions: participants });
            }
        } catch (err) {
            console.error('Error handling group update:', err.message);
        }
    });

    // ==========================================
    // HANDLER PESAN MASUK
    // ==========================================
    sock.ev.on('messages.upsert', async (m) => {
        await handleCommand(sock, m.messages[0]);
    });

    console.log('🚀 Bot system initialized...');
}

startBot().catch(console.error);