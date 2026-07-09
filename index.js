const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadMediaMessage,
    downloadContentFromMessage,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');

ffmpeg.setFfmpegPath(ffmpegPath);

// ==========================================
// ANTI-SPAM: Track user yang sedang proses
// ==========================================
const processingUsers = new Map();

// OWNER JID
const OWNER_JID = "6285174116973@s.whatsapp.net"; 

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
        syncFullHistory: true, // PENTING!
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
            console.log('✅ Bot berhasil online dan terhubung!');
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
                console.log('⚠️ Tidak bisa akses metadata grup, menggunakan nama default');
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
                welcomeText += `, selamat datang di grup *${groupName}*! \n\n📌 *Tata Tertib Singkat:*\nMohon untuk mengubah nama kontak kamu menjadi format *nama_RMED* agar sesama member bisa saling save contact (SV) dengan mudah ya.\n\n🎮 *Gabung Komunitas Discord Kami!*\nYuk merapat ke server Discord kita:\n🔗 https://discord.gg/xPUVCG2mgq\n\n✨ _Disponsori oleh: averanteam.web.id_\n\nSalam hangat dari kami! 🤖`;

                await sock.sendMessage(anu.id, { text: welcomeText, mentions: participants });
            }
            else if (anu.action === 'remove') {
                let leaveText = `Selamat jalan `;
                for (let participant of participants) {
                    leaveText += `@${participant.split('@')[0]} `;
                }
                leaveText += `\n\nTerima kasih sudah mampir di *${groupName}*. Sampai jumpa! 👋\n\n✨ _Disponsori oleh: averanteam.web.id_`;

                await sock.sendMessage(anu.id, { text: leaveText, mentions: participants });
            }
        } catch (err) {
            console.error('Error handling group update:', err.message);
        }
    });

    // ==========================================
    // FITUR COMMAND
    // ==========================================
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const message = m.messages[0];
            if (!message.message) return;
            if (message.key.fromMe) return;

            const from = message.key.remoteJid;
            const sender = message.key.participant || from;
            const cleanSender = jidNormalizedUser(sender);

            const text = (
                message.message?.conversation ||
                message.message?.extendedTextMessage?.text ||
                message.message?.imageMessage?.caption ||
                message.message?.videoMessage?.caption ||
                ''
            ).trim().toLowerCase();

            const hasImage = !!message.message?.imageMessage;
            const hasVideo = !!message.message?.videoMessage;

            const contextInfo = message.message?.extendedTextMessage?.contextInfo;
            const isQuoted = !!contextInfo?.quotedMessage;
            const quotedMessage = contextInfo?.quotedMessage || null;
            const quotedType = quotedMessage ? Object.keys(quotedMessage)[0] : null;

            // ==========================================
            // COMMAND: .s atau .stiker
            // ==========================================
            if (text === '.s' || text === '.stiker') {
                if (processingUsers.has(sender)) {
                    await sock.sendMessage(from, {
                        text: '⚠️ Kamu masih memiliki permintaan yang sedang diproses. Mohon tunggu hingga selesai.'
                    }, { quoted: message });
                    return;
                }

                processingUsers.set(sender, true);

                try {
                    let mediaBuffer = null;
                    let isVideo = false;

                    if (isQuoted && (quotedType === 'imageMessage' || quotedType === 'videoMessage')) {
                        console.log('📸 Mengkonversi media yang di-reply...');

                        const quotedMsg = {
                            message: quotedMessage,
                            key: {
                                remoteJid: from,
                                fromMe: false,
                                id: contextInfo.stanzaId
                            }
                        };

                        mediaBuffer = await downloadMediaMessage(
                            quotedMsg,
                            'buffer',
                            {},
                            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                        );

                        isVideo = quotedType === 'videoMessage';
                    }
                    else if (hasImage || hasVideo) {
                        console.log('📸 Mengkonversi media langsung...');

                        mediaBuffer = await downloadMediaMessage(
                            message,
                            'buffer',
                            {},
                            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                        );

                        isVideo = hasVideo;
                    }

                    if (!mediaBuffer) {
                        await sock.sendMessage(from, {
                            text: '❌ Kirim gambar/video dengan caption `.s` atau reply gambar/video dengan `.s`'
                        }, { quoted: message });
                        return;
                    }

                    if (isVideo) {
                        const duration = hasVideo ?
                            message.message.videoMessage?.seconds || 0 :
                            quotedMessage?.videoMessage?.seconds || 0;

                        if (duration > 15) {
                            await sock.sendMessage(from, {
                                text: `⚠️ Video terlalu panjang! Maksimal 15 detik.\nDurasi: ${duration} detik.`
                            }, { quoted: message });
                            return;
                        }
                    }

                    const sticker = new Sticker(mediaBuffer, {
                        pack: 'Bronya Zaychik',
                        author: 'Lorelei Project',
                        type: StickerTypes.FULL,
                        categories: ['🤩', ''],
                        id: '12345',
                        quality: 50
                    });

                    const stickerBuffer = await sticker.toBuffer();

                    await sock.sendMessage(from, {
                        sticker: stickerBuffer
                    }, { quoted: message });

                    console.log('✅ Stiker berhasil dibuat!');
                } finally {
                    processingUsers.delete(sender);
                }
            }

            // ==========================================
            // COMMAND: .nvo - EXTRACT VIEW ONCE (SIAPA SAJA BISA PAKAI)
            // ==========================================
            else if (text === '.nvo') {
                if (processingUsers.has(sender)) {
                    await sock.sendMessage(from, {
                        text: '⚠️ Kamu masih memiliki permintaan yang sedang diproses. Mohon tunggu hingga selesai.'
                    }, { quoted: message });
                    return;
                }

                processingUsers.set(sender, true);

                try {
                    console.log('[PROCESS] Perintah .nvo dari:', cleanSender);

                    const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    if (!quotedMsg) {
                        console.log('[DEBUG] Gagal: Tidak ada media yang di-reply.');
                        await sock.sendMessage(from, {
                            text: '❌ Reply pesan view once dengan command `.nvo`\n\nCara pakai:\n1. Reply pesan view once\n2. Ketik `.nvo`'
                        }, { quoted: message });
                        return;
                    }

                    let mediaMessage = null;
                    let mediaType = null;

                    // Cek view once wrapper
                    const viewOnce = quotedMsg.viewOnceMessageV2?.message || quotedMsg.viewOnceMessage?.message;
                    const targetMsg = viewOnce || quotedMsg;

                    if (targetMsg.imageMessage) {
                        mediaMessage = targetMsg.imageMessage;
                        mediaType = 'image';
                    }
                    else if (targetMsg.videoMessage) {
                        mediaMessage = targetMsg.videoMessage;
                        mediaType = 'video';
                    }
                    else if (targetMsg.stickerMessage) {
                        mediaMessage = targetMsg.stickerMessage;
                        mediaType = 'sticker';
                    }
                    else if (targetMsg.documentMessage) {
                        mediaMessage = targetMsg.documentMessage;
                        mediaType = 'document';
                    }
                    else if (targetMsg.audioMessage) {
                        mediaMessage = targetMsg.audioMessage;
                        mediaType = 'audio';
                    }

                    if (mediaMessage && mediaType) {
                        try {
                            console.log(`[DOWNLOAD] Sedang mengunduh ${mediaType}...`);
                            const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                            let buffer = Buffer.from([]);
                            for await (const chunk of stream) {
                                buffer = Buffer.concat([buffer, chunk]);
                            }

                            console.log(`[SUCCESS] Media berhasil didownload: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);

                            // KIRIM BALIK KE CHAT YANG SAMA (bukan cuma ke owner)
                            if (mediaType === 'image') {
                                await sock.sendMessage(from, {
                                    image: buffer,
                                    caption: "👁️ *View Once Extracted*"
                                }, { quoted: message });
                            }
                            else if (mediaType === 'video') {
                                await sock.sendMessage(from, {
                                    video: buffer,
                                    caption: "👁️ *View Once Extracted*"
                                }, { quoted: message });
                            }
                            else if (mediaType === 'sticker') {
                                await sock.sendMessage(from, {
                                    sticker: buffer
                                }, { quoted: message });
                            }
                            else if (mediaType === 'audio') {
                                await sock.sendMessage(from, {
                                    audio: buffer,
                                    mimetype: 'audio/mp4',
                                    ptt: mediaMessage.ptt
                                }, { quoted: message });
                            }
                            else {
                                await sock.sendMessage(from, {
                                    document: buffer,
                                    mimetype: mediaMessage.mimetype,
                                    fileName: mediaMessage.fileName || 'file',
                                    caption: "👁️ *View Once Extracted*"
                                }, { quoted: message });
                            }

                            // Juga kirim backup ke owner
                            if (mediaType === 'image') {
                                await sock.sendMessage(OWNER_JID, {
                                    image: buffer,
                                    caption: `Extract dari: ${cleanSender}`
                                });
                            } else if (mediaType === 'video') {
                                await sock.sendMessage(OWNER_JID, {
                                    video: buffer,
                                    caption: `Extract dari: ${cleanSender}`
                                });
                            }

                            console.log(`[SUCCESS] Media berhasil dikirim ke chat dan owner.`);
                        } catch (err) {
                            console.error("[ERROR] Gagal proses media:", err);
                            await sock.sendMessage(from, {
                                text: `❌ Gagal extract media.\n\nError: ${err.message}`
                            }, { quoted: message });
                        }
                    } else {
                        await sock.sendMessage(from, {
                            text: '❌ Tidak ditemukan media di pesan yang di-reply.\n\nPastikan pesan yang di-reply adalah view once (foto/video sekali lihat).'
                        }, { quoted: message });
                    }
                } finally {
                    processingUsers.delete(sender);
                }
            }

            // ==========================================
            // COMMAND: .p atau .ping
            // ==========================================
            else if (text === '.p' || text === '.ping') {
                console.log('🏓 Ping command diterima!');

                const botImagePath = path.join(__dirname, 'bronya.jpg');

                if (fs.existsSync(botImagePath)) {
                    await sock.sendMessage(from, {
                        image: fs.readFileSync(botImagePath),
                        caption: `🤖 *BRONYA ZAYCHIK*\n\n✅ *Status:* Online & Aktif!\n\n👤 *Created by:* Lorelei Project\n🔗 *GitHub:* https://github.com/LoreleiDev\n\n✨ _Disponsori oleh: averanteam.web.id_`
                    }, { quoted: message });
                } else {
                    await sock.sendMessage(from, {
                        text: `🤖 *BRONYA ZAYCHIK*\n\n✅ *Status:* Online & Aktif!\n\n👤 *Created by:* Lorelei Project\n🔗 *GitHub:* https://github.com/LoreleiDev\n\n✨ _Disponsori oleh: averanteam.web.id_`
                    }, { quoted: message });
                }
            }

            // ==========================================
            // COMMAND: .l atau .list
            // ==========================================
            else if (text === '.l' || text === '.list') {
                console.log('📋 List command diminta!');

                const listText = `🤖 *BRONYA ZAYCHIK - Command List*

📌 *Stiker & Media:*
• *.s* atau *.stiker* - Buat stiker dari gambar/video
  └ Kirim gambar/video dengan caption .s
  └ Atau reply gambar/video dengan .s
  └ Video maksimal 15 detik

👁️ *View Once Extractor:*
• *.nvo* - Extract pesan view once (sekali lihat)
  └ Reply pesan view once dengan .nvo
  └ Support: image, video, audio, document
  └ Media akan dikirim balik ke chat
  └ Siapa saja bisa pakai!

📡 *Status Bot:*
• *.p* atau *.ping* - Cek status bot & info creator

📋 *Informasi:*
• *.l* atau *.list* - Tampilkan list command ini

✨ _Disponsori oleh: averanteam.web.id_

👤 _Created by: Lorelei Project_
🔗 _GitHub: https://github.com/LoreleiDev_`;

                await sock.sendMessage(from, {
                    text: listText
                }, { quoted: message });
            }
        } catch (err) {
            console.error('Error handling command:', err.message);
        }
    });
}

startBot().catch(console.error);