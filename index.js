const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const { handleCommand } = require('./handlers/commandHandler');
const settings = require('./config/settings');

// ==========================================
// KONFIGURASI NOMOR TARGET
// ==========================================
// Format: Kode negara (62) + Nomor tanpa 0, spasi, atau tanda +
// Contoh: +62 823-2977-6414 menjadi '6282329776414'
const TARGET_PHONE_NUMBER = '6282329776414'; 

// Pastikan folder data dan session ada
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
        printQRInTerminal: false, // Kita nonaktifkan QR, ganti pakai Pairing Code
        logger: pino({ level: 'silent' }),
        syncFullHistory: false, // Diubah ke false agar login lebih cepat dan ringan
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', saveCreds);

    // ==========================================
    // KONEKSI & PAIRING CODE
    // ==========================================
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Jika bot meminta QR, kita intercept dan minta Pairing Code saja
        if (qr) {
            console.clear();
            console.log('🔄 Meminta Kode Pairing untuk nomor WhatsApp...');
            try {
                // Minta kode pairing ke server WhatsApp
                const code = await sock.requestPairingCode(TARGET_PHONE_NUMBER);
                console.log('\n' + '═'.repeat(40));
                console.log(`✅ KODE PAIRING KAMU: ${code}`);
                console.log('═'.repeat(40));
                console.log('\n📱 Cara Tautkan:');
                console.log('1. Buka WhatsApp di HP (nomor target)');
                console.log('2. Pengaturan > Perangkat Tertaut > Tautkan Perangkat');
                console.log('3. Pilih "Tautkan dengan nomor telepon" (bukan scan QR)');
                console.log(`4. Masukkan kode: ${code}`);
                console.log('\n⏳ Menunggu koneksi...\n');
            } catch (err) {
                console.error('❌ Gagal meminta kode pairing:', err.message);
            }
        }

        if (connection === 'connecting') {
            console.log('🔄 Menghubungkan ke WhatsApp...');
        }

        if (connection === 'open') {
            console.clear();
            console.log(`✅ ${settings.BOT_NAME || 'Bot'} berhasil online dan terhubung!`);
            console.log(`👤 Terhubung ke: ${TARGET_PHONE_NUMBER}`);
            console.log(`✨ Ready to serve!`);
        }

        if (connection === 'close') {
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (statusCode === DisconnectReason.loggedOut) {
                console.log('❌ Perangkat logout. Hapus folder "session" lalu jalankan ulang untuk pairing ulang.');
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
                let leaveText = `👋 Selamat jalan `;
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