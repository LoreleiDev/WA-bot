const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const { setProcessing, isProcessing } = require('../utils/antiSpam');
const settings = require('../config/settings');

async function handleProfile(sock, from, message, textLower, isGroup, mentionedJid) {
    const sender = message.key.participant || from;
    const cleanSender = jidNormalizedUser(sender);

    if (isProcessing(sender)) {
        await sock.sendMessage(from, {
            text: '️ _Kamu masih memiliki permintaan yang sedang diproses. Mohon tunggu._'
        }, { quoted: message });
        return;
    }

    setProcessing(sender);

    try {
        let targetJid = cleanSender;
        let isSelf = true;

        if (mentionedJid && mentionedJid.length > 0) {
            targetJid = jidNormalizedUser(mentionedJid[0]);
            isSelf = false;
        }

        let userRole = 'Member';
        let groupName = 'Private Chat';
        let targetPhoneNumber = null;

        if (isGroup) {
            try {
                const groupMetadata = await sock.groupMetadata(from);
                groupName = groupMetadata.subject;

                const participant = groupMetadata.participants.find(p => 
                    jidNormalizedUser(p.id) === targetJid
                );

                if (participant) {
                    if (participant.phoneNumber) {
                        targetPhoneNumber = participant.phoneNumber.split('@')[0];
                    }
                    if (participant.admin === 'admin' || participant.admin === 'superadmin') {
                        userRole = participant.admin === 'superadmin' ? 'Super Admin' : 'Admin';
                    }
                }
            } catch (e) {
                console.log('⚠️ Error ambil metadata grup:', e.message);
            }
        }

        const userId = targetPhoneNumber || targetJid.split('@')[0];
        const isOwner = targetJid === settings.OWNER_JID;
        const roleText = isOwner ? ' *Owner Bot*' : `👤 *${userRole}*`;

        const profileText = `🤖 *INFO PROFIL${isSelf ? ' KAMU' : ' USER'}*

👤 *Nama:* @${targetJid.split('@')[0]}
📱 *Nomor:* +${userId}
${roleText}${isGroup ? `\n *Grup:* ${groupName}` : ''}

━━━━━━━━━━━━━━━━━━━━━

🤖 *Bot Info:*
• Nama: ${settings.BOT_NAME}
• Creator: ${settings.CREATOR}
• GitHub: ${settings.GITHUB}

${createFooter()}`;

        await sock.sendMessage(from, {
            text: profileText,
            mentions: [targetJid]
        }, { quoted: message });

    } catch (err) {
        console.error('Error profile:', err);
        await sock.sendMessage(from, {
            text: `❌ _Gagal menampilkan profil._\n\n_Error: ${err.message}_`
        }, { quoted: message });
    } finally {
        setProcessing(sender, false);
    }
}

function createFooter() {
    return `_Disponsori oleh: ${settings.SPONSOR}_`;
}

module.exports = { handleProfile };