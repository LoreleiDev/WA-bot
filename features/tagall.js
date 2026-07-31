const { setProcessing, isProcessing } = require('../utils/antiSpam');

async function handleTagAll(sock, from, message, text, isGroup, isQuoted, quotedMessage) {
    const sender = message.key.participant || from;

    // Validasi: Harus di grup
    if (!isGroup) {
        await sock.sendMessage(from, {
            text: '❌ _Maaf, fitur `.tagall` hanya dapat digunakan di dalam grup!_'
        }, { quoted: message });
        return;
    }

    // Validasi: Harus reply pesan
    if (!isQuoted) {
        await sock.sendMessage(from, {
            text: '❌ _Reply pesan yang ingin di-tagall!_\n\n_Cara pakai:_\n_1. Reply pesan yang ingin disebar_\n_2. Ketik `.tagall`_'
        }, { quoted: message });
        return;
    }

    if (isProcessing(sender)) {
        await sock.sendMessage(from, {
            text: '⚠️ _Kamu masih memiliki permintaan yang sedang diproses. Mohon tunggu._'
        }, { quoted: message });
        return;
    }

    setProcessing(sender);

    try {
        const groupMetadata = await sock.groupMetadata(from);
        const groupName = groupMetadata.subject || 'Grup';
        const participants = groupMetadata.participants.map(p => p.id);

        if (participants.length === 0) {
            await sock.sendMessage(from, {
                text: '❌ _Tidak ada member di grup ini._'
            }, { quoted: message });
            return;
        }

        // Ambil pesan yang di-reply
        const quotedText = quotedMessage.conversation || 
                          quotedMessage.extendedTextMessage?.text || 
                          '[Pesan yang di-reply]';

        // Bot akan reply pesan tersebut dengan mention semua member
        await sock.sendMessage(from, {
            text: ` *${groupName}*\n\n${quotedText}\n\n👥 _${participants.length} member_`,
            mentions: participants
        }, { quoted: message });

        console.log(`✅ Berhasil hidetag ${participants.length} member!`);

    } catch (err) {
        console.error('Error tag all:', err);
        await sock.sendMessage(from, {
            text: `❌ _Gagal melakukan tag all._\n\n_Error: ${err.message}_`
        }, { quoted: message });
    } finally {
        setProcessing(sender, false);
    }
}

module.exports = { handleTagAll };