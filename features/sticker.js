const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const { setProcessing, isProcessing } = require('../utils/antiSpam');
const pino = require('pino');

async function handleSticker(sock, from, message, textLower, isQuoted, quotedType, quotedMessage, hasImage, hasVideo) {
    const sender = message.key.participant || from;

    if (isProcessing(sender)) {
        await sock.sendMessage(from, {
            text: '⚠️ _Kamu masih memiliki permintaan yang sedang diproses. Mohon tunggu hingga selesai._'
        }, { quoted: message });
        return;
    }

    setProcessing(sender);

    try {
        let mediaBuffer = null;
        let isVideo = false;

        // 1. Ambil media dari pesan yang di-reply
        if (isQuoted && (quotedType === 'imageMessage' || quotedType === 'videoMessage')) {
            const quotedMsg = {
                message: quotedMessage,
                key: { remoteJid: from, fromMe: false, id: message.message.extendedTextMessage.contextInfo.stanzaId }
            };
            mediaBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {}, {
                logger: pino({ level: 'silent' }),
                reuploadRequest: sock.updateMediaMessage
            });
            isVideo = quotedType === 'videoMessage';
        } 
        // 2. Atau ambil media dari pesan langsung (dikirim dengan caption)
        else if (hasImage || hasVideo) {
            mediaBuffer = await downloadMediaMessage(message, 'buffer', {}, {
                logger: pino({ level: 'silent' }),
                reuploadRequest: sock.updateMediaMessage
            });
            isVideo = hasVideo;
        }

        // 3. Validasi jika tidak ada media
        if (!mediaBuffer) {
            await sock.sendMessage(from, {
                text: '❌ _Kirim gambar/video dengan caption `.s` atau reply gambar/video dengan `.s`_'
            }, { quoted: message });
            return;
        }

        // 4. Validasi durasi video (maksimal 15 detik)
        if (isVideo) {
            const duration = hasVideo ? message.message.videoMessage?.seconds || 0 : quotedMessage?.videoMessage?.seconds || 0;
            if (duration > 15) {
                await sock.sendMessage(from, {
                    text: `⚠️ _Video terlalu panjang! Maksimal 15 detik._\n_Durasi: ${duration} detik._`
                }, { quoted: message });
                return;
            }
        }

        // 5. Proses pembuatan stiker normal
        const sticker = new Sticker(mediaBuffer, {
            pack: 'made by Bronya Zaychik [BOT]',
            author: 'Lorelei Project',
            type: StickerTypes.FULL,
            categories: ['🤩', ''],
            quality: 50
        });

        const stickerBuffer = await sticker.toBuffer();

        await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: message });
        console.log('✅ Stiker berhasil dibuat!');

    } catch (err) {
        console.error('❌ Error saat membuat stiker:', err.message);
        await sock.sendMessage(from, {
            text: '❌ _Gagal membuat stiker. Pastikan format gambar/video didukung._'
        }, { quoted: message });
    } finally {
        setProcessing(sender, false);
    }
}

module.exports = { handleSticker };