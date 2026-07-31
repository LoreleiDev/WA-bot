const { handleSticker } = require('../features/sticker');
const { handleCatat, handleCatatan } = require('../features/notes');
const { handleTagAll } = require('../features/tagall');
const { handlePing, handleList } = require('../features/info');
const { handleProfile } = require('../features/profile');
const settings = require('../config/settings');
const { jidNormalizedUser } = require('@whiskeysockets/baileys'); // Ditambahkan untuk validasi owner yang akurat

// Flag untuk bot active/inactive
// CATATAN: Nilai ini akan kembali ke 'true' setiap kali bot di-restart.
let isBotActive = true;

async function handleCommand(sock, message) {
    try {
        if (!message.message) return;
        if (message.key.fromMe) return;

        const from = message.key.remoteJid;
        
        // 1. NORMALISASI JID AGAR VALIDASI OWNER 100% AKURAT
        const sender = jidNormalizedUser(message.key.participant || from);
        const ownerJid = jidNormalizedUser(settings.OWNER_JID);
        
        const isGroup = from.endsWith('@g.us');

        const rawText = (
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            message.message?.imageMessage?.caption ||
            message.message?.videoMessage?.caption ||
            ''
        ).trim();

        const textLower = rawText.toLowerCase();

        // ==========================================
        // 2. LOGIC .START DAN .STOP (DIPERBAIKI)
        // ==========================================
        if (textLower === '.start' || textLower === '.stop') {
            // Cek apakah yang mengetik benar-benar owner
            if (sender !== ownerJid) {
                console.log(`⚠️ Percobaan .start/.stop ditolak. Sender: ${sender} | Owner: ${ownerJid}`);
                // Opsional: Bisa kasih tau user kalau dia bukan owner
                // await sock.sendMessage(from, { text: '❌ _Kamu bukan owner bot!_' }, { quoted: message });
                return; 
            }

            if (textLower === '.start') {
                isBotActive = true;
                await sock.sendMessage(from, {
                    text: '✅ _Bot telah diaktifkan! Silakan gunakan command seperti biasa._'
                }, { quoted: message });
                console.log('✅ Bot activated by owner');
                return; // Stop eksekusi di sini
            }

            if (textLower === '.stop') {
                isBotActive = false;
                await sock.sendMessage(from, {
                    text: '⏸️ _Bot telah dinonaktifkan (pause mode)._ \n_Hanya owner yang bisa menggunakan `.start` untuk mengaktifkannya kembali._'
                }, { quoted: message });
                console.log('⏸️ Bot deactivated by owner');
                return; // Stop eksekusi di sini
            }
        }

        // 3. CEK STATUS BOT (Jika mati, abaikan semua command di bawah ini)
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
        // 4. ROUTING COMMANDS
        // ==========================================
        
        if (textLower === '.s' || textLower === '.stiker') {
            await handleSticker(sock, from, message, textLower, isQuoted, quotedType, quotedMessage, hasImage, hasVideo);
        }
        else if (textLower.startsWith('.catat ')) {
            await handleCatat(sock, from, message, rawText, isQuoted, quotedMessage, quotedType);
        }
        else if (textLower === '.catatan' || textLower.startsWith('.catatan ')) {
            await handleCatatan(sock, from, message, rawText);
        }
        else if (textLower === '.tagall') {
            await handleTagAll(sock, from, message, rawText, isGroup, isQuoted, quotedMessage);
        }
        else if (textLower === '.p' || textLower === '.ping') {
            await handlePing(sock, from, message);
        }
        else if (textLower === '.l' || textLower === '.list') {
            await handleList(sock, from, message);
        }
        // 5. FITUR KHUSUS GRUP: .me dan .profile
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
        console.error('Error handling command:', err.message);
    }
}

module.exports = { handleCommand };