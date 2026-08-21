const { handleSticker } = require('../features/sticker');
const { handleCatat, handleCatatan, handleHapusCatatan } = require('../features/notes');
const { handleTagAll } = require('../features/tagall');
const { handlePing, handleList } = require('../features/info');
const { handleProfile } = require('../features/profile');
const { handleNvo } = require('../features/nvo');
const { enqueue } = require('../utils/antiSpam');
const settings = require('../config/settings');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');

let isBotActive = false;

async function handleCommand(sock, message) {
    try {
        if (!message.message) return;
        if (message.key.fromMe) return;

        const from = message.key.remoteJid;

        // Normalisasi JID pengirim
        const sender = jidNormalizedUser(message.key.participant || from);

        // Normalisasi JID Owner (dari nomor HP dan dari LID)
        const ownerJid = jidNormalizedUser(settings.OWNER_JID);
        const ownerLid = settings.OWNER_LID ? jidNormalizedUser(settings.OWNER_LID) : null;

        // Cek apakah pengirim adalah Owner
        const isOwner = (sender === ownerJid) || (sender === ownerLid);
        const isGroup = from.endsWith('@g.us'); // <--- INI KUNCINYA

        const rawText = (
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            message.message?.imageMessage?.caption ||
            message.message?.videoMessage?.caption ||
            ''
        ).trim();

        const textLower = rawText.toLowerCase();

        // ==========================================
        // 1. LOGIC .START DAN .STOP (Hanya Owner)
        // ==========================================
        if (textLower === '.start' || textLower === '.stop') {
            if (!isOwner) {
                await sock.sendMessage(from, {
                    text: '❌ _Maaf, perintah ini hanya dapat digunakan oleh Owner bot!_'
                }, { quoted: message });
                console.log(`⚠️ Percobaan .start/.stop ditolak. Sender: ${sender}`);
                return;
            }

            if (textLower === '.start') {
                isBotActive = true;
                await sock.sendMessage(from, {
                    text: '✅ _Bot telah diaktifkan! Silakan gunakan command seperti biasa._'
                }, { quoted: message });
                console.log('✅ Bot activated by owner');
                return;
            }

            if (textLower === '.stop') {
                isBotActive = false;
                await sock.sendMessage(from, {
                    text: '⏸️ _Bot telah dinonaktifkan (pause mode)._ '
                }, { quoted: message });
                console.log('⏸️ Bot deactivated by owner');
                return;
            }
        }

        // ==========================================
        // 2. PENGECUALIAN: .p / .ping (Bisa dipakai kapan saja)
        // ==========================================
        if (textLower === '.p' || textLower === '.ping') {
            await handlePing(sock, from, message, isBotActive);
            return;
        }

        // ==========================================
        // 3. CEK STATUS BOT (Jika mati, abaikan semua command lainnya)
        // ==========================================
        if (!isBotActive) {
            return;
        }

        const contextInfo = message.message?.extendedTextMessage?.contextInfo;
        const isQuoted = !!contextInfo?.quotedMessage;
        const quotedMessage = contextInfo?.quotedMessage || null;
        const quotedType = quotedMessage ? Object.keys(quotedMessage)[0] : null;
        const mentionedJid = contextInfo?.mentionedJid;
        const hasImage = !!message.message?.imageMessage;
        const hasVideo = !!message.message?.videoMessage;
        
        // ==========================================
        // HELPER: Pembungkus Antrian (Queue Task)
        // ==========================================
        const createTask = (executeFn) => ({
            run: executeFn,
            onQueued: async () => {
                await sock.sendMessage(from, { 
                    text: '⏳ _Permintaanmu sedang di antrian, sedang diproses... mohon tunggu._' 
                }, { quoted: message });
            }
        });

        // ==========================================
        // 4. ROUTING COMMANDS
        // ==========================================
        if (textLower === '.s' || textLower === '.stiker') {
            await enqueue(sender, createTask(() => handleSticker(sock, from, message, textLower, isQuoted, quotedType, quotedMessage, hasImage, hasVideo)));
        }
        else if (textLower === '.nvo') {
            await handleNvo(sock, from, message, isQuoted, quotedMessage);
        }

        // ==========================================
        // FITUR KHUSUS GRUP: CATATAN
        // ==========================================
        else if (textLower.startsWith('.catat ')) {
            if (!isGroup) {
                await sock.sendMessage(from, { text: '❌ _Maaf, fitur `.catat` hanya dapat digunakan di dalam grup!_' }, { quoted: message });
                return;
            }
            await enqueue(sender, createTask(() => handleCatat(sock, from, message, rawText, isQuoted, quotedMessage, quotedType)));
        }
        else if (textLower === '.catatan' || textLower.startsWith('.catatan ')) {
            if (!isGroup) {
                await sock.sendMessage(from, { text: '❌ _Maaf, fitur `.catatan` hanya dapat digunakan di dalam grup!_' }, { quoted: message });
                return;
            }
            await enqueue(sender, createTask(() => handleCatatan(sock, from, message, rawText)));
        }
        else if (textLower === '.hapuscatatan' || textLower.startsWith('.hapuscatatan ')) { 
            if (!isGroup) {
                await sock.sendMessage(from, { text: '❌ _Maaf, fitur `.hapuscatatan` hanya dapat digunakan di dalam grup!_' }, { quoted: message });
                return;
            }
            await enqueue(sender, createTask(() => handleHapusCatatan(sock, from, message, rawText)));
        }

        // ==========================================
        // FITUR LAINNYA
        // ==========================================
        else if (textLower === '.tagall') {
            if (!isGroup) {
                await sock.sendMessage(from, {
                    text: '❌ _Maaf, fitur `.tagall` hanya dapat digunakan di dalam grup!_'
                }, { quoted: message });
                return;
            }
            await handleTagAll(sock, from, message, rawText, isGroup, isQuoted, quotedMessage);
        }
        else if (textLower === '.l' || textLower === '.list') {
            await handleList(sock, from, message);
        }
        else if (textLower === '.me' || textLower.startsWith('.profile')) {
            if (!isGroup) {
                await sock.sendMessage(from, {
                    text: '❌ _Maaf, fitur `.me` dan `.profile` hanya dapat digunakan di dalam grup!_'
                }, { quoted: message });
                return;
            }
            await handleProfile(sock, from, message, textLower, isGroup, mentionedJid);
        } 

    } catch (err) {
        if (err.message === 'FLOOD_DETECTED') {
            await sock.sendMessage(from, { text: '⚠️ _Kamu mengirim command terlalu cepat, mohon tunggu 10 detik._' }, { quoted: message });
        } else {
            console.error('Error handling command:', err.message);
        }
    }
}

module.exports = { handleCommand };