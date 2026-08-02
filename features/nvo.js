const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { isProcessing, setProcessing } = require('../utils/antiSpam');

async function handleNvo(sock, from, message, isQuoted, quotedMessage) {
    const sender = message.key.participant || from;

    if (isProcessing(sender)) {
        await sock.sendMessage(from, {
            text: '⚠️ _Kamu masih memiliki permintaan yang sedang diproses. Mohon tunggu hingga selesai._'
        }, { quoted: message });
        return;
    }

    setProcessing(sender);

    try {
        console.log('[PROCESS] Perintah .nvo dari:', sender);

        if (!isQuoted || !quotedMessage) {
            await sock.sendMessage(from, {
                text: '❌ _Reply pesan view once dengan command `.nvo`_\n\n_Cara pakai:_\n_1. Reply pesan view once (foto/video sekali lihat)_\n_2. Ketik `.nvo`_'
            }, { quoted: message });
            return;
        }

        let mediaMessage = null;
        let mediaType = null;

        // Cek viewOnceMessageV2 atau viewOnceMessage (format lama & baru)
        const viewOnce = quotedMessage.viewOnceMessageV2?.message || quotedMessage.viewOnceMessage?.message;
        const targetMsg = viewOnce || quotedMessage;

        if (targetMsg.imageMessage) {
            mediaMessage = targetMsg.imageMessage;
            mediaType = 'image';
        } else if (targetMsg.videoMessage) {
            mediaMessage = targetMsg.videoMessage;
            mediaType = 'video';
        } else if (targetMsg.stickerMessage) {
            mediaMessage = targetMsg.stickerMessage;
            mediaType = 'sticker';
        } else if (targetMsg.documentMessage) {
            mediaMessage = targetMsg.documentMessage;
            mediaType = 'document';
        } else if (targetMsg.audioMessage) {
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

                if (mediaType === 'image') {
                    await sock.sendMessage(from, {
                        image: buffer,
                        caption: "👁️ *View Once Extracted*"
                    }, { quoted: message });
                } else if (mediaType === 'video') {
                    await sock.sendMessage(from, {
                        video: buffer,
                        caption: "👁️ *View Once Extracted*"
                    }, { quoted: message });
                } else if (mediaType === 'sticker') {
                    await sock.sendMessage(from, {
                        sticker: buffer
                    }, { quoted: message });
                } else if (mediaType === 'audio') {
                    await sock.sendMessage(from, {
                        audio: buffer,
                        mimetype: mediaMessage.mimetype || 'audio/mp4',
                        ptt: mediaMessage.ptt || false
                    }, { quoted: message });
                } else {
                    await sock.sendMessage(from, {
                        document: buffer,
                        mimetype: mediaMessage.mimetype || 'application/octet-stream',
                        fileName: mediaMessage.fileName || 'file',
                        caption: "👁️ *View Once Extracted*"
                    }, { quoted: message });
                }

                console.log(`[SUCCESS] Media berhasil dikirim ke chat.`);
            } catch (err) {
                console.error("[ERROR] Gagal proses media:", err);
                await sock.sendMessage(from, {
                    text: `❌ _Gagal extract media._\n\n_Error: ${err.message}_`
                }, { quoted: message });
            }
        } else {
            await sock.sendMessage(from, {
                text: '❌ _Tidak ditemukan media di pesan yang di-reply._\n\n_Pastikan pesan yang di-reply adalah view once (foto/video sekali lihat)._'
            }, { quoted: message });
        }
    } finally {
        setProcessing(sender, false);
    }
}

module.exports = { handleNvo };