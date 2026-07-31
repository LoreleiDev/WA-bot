const fs = require('fs').promises;
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { setProcessing, isProcessing } = require('../utils/antiSpam');
const settings = require('../config/settings');
const axios = require('axios');
const FormData = require('form-data');

const NOTES_FILE = path.join(__dirname, '../data/notes.json');

async function loadNotes() {
    try {
        const data = await fs.readFile(NOTES_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return {};
    }
}

async function saveNotes(notes) {
    await fs.writeFile(NOTES_FILE, JSON.stringify(notes, null, 2));
}

// FUNGSI UPLOAD DENGAN FALLBACK (CATBOX -> UGUU)
async function uploadFile(buffer, mimetype, originalName) {
    if (!buffer || buffer.length === 0) {
        throw new Error('File buffer kosong atau gagal didownload.');
    }

    const fileName = originalName || `file_${Date.now()}`;

    // 1. Coba Catbox dulu
    try {
        const catboxForm = new FormData();
        catboxForm.append('reqtype', 'fileupload');
        catboxForm.append('fileToUpload', buffer, { filename: fileName, contentType: mimetype });

        const catboxRes = await axios.post('https://catbox.moe/user/api.php', catboxForm, {
            headers: catboxForm.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 15000
        });

        if (catboxRes.status === 200 && String(catboxRes.data).startsWith('https://')) {
            return { url: catboxRes.data, provider: 'Catbox' };
        }
    } catch (err) {
        console.log('⚠️ Catbox gagal, mencoba fallback ke Uguu.se...');
    }

    // 2. Fallback ke Uguu.se
    try {
        const uguuForm = new FormData();
        uguuForm.append('files[]', buffer, { filename: fileName, contentType: mimetype });

        const uguuRes = await axios.post('https://uguu.se/upload.php', uguuForm, {
            headers: uguuForm.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 15000
        });

        if (uguuRes.data && uguuRes.data.files && uguuRes.data.files[0]) {
            return { url: uguuRes.data.files[0].url, provider: 'Uguu' };
        }
    } catch (err) {
        console.error('❌ Uguu juga gagal:', err.message);
    }

    throw new Error('Semua server upload (Catbox & Uguu) gagal.');
}

async function handleCatat(sock, from, message, text, isQuoted, quotedMessage, quotedType) {
    const sender = message.key.participant || from;
    const userId = sender.split('@')[0];

    if (isProcessing(sender)) {
        await sock.sendMessage(from, { text: '⚠️ _Kamu masih memiliki permintaan yang sedang diproses. Mohon tunggu._' }, { quoted: message });
        return;
    }

    setProcessing(sender);

    try {
        // 1. Ekstrak Judul dari perintah (contoh: ".catat tugas kuliah" -> judul: "tugas kuliah")
        const args = text.split(' ');
        const title = args.slice(1).join(' ').trim();

        if (!title) {
            await sock.sendMessage(from, {
                text: '❌ _Format salah!_\n\n_Cara pakai:_\n_Reply pesan yang ingin disimpan, lalu ketik:_\n`.catat <judul catatan>`\n\n_Contoh: `.catat resep nasi goreng`_'
            }, { quoted: message });
            return;
        }

        if (!isQuoted) {
            await sock.sendMessage(from, {
                text: '❌ _Kamu wajib me-reply pesan yang ingin dicatat!_'
            }, { quoted: message });
            return;
        }

        const notes = await loadNotes();
        if (!notes[userId]) {
            notes[userId] = [];
        }

        // Cek apakah judul sudah ada (opsional, tapi bagus untuk mencegah duplikat)
        const existingNote = notes[userId].find(n => n.title.toLowerCase() === title.toLowerCase());
        if (existingNote) {
            await sock.sendMessage(from, {
                text: `⚠️ _Catatan dengan judul "**${title}**" sudah ada. Gunakan judul yang berbeda atau hapus catatan lama terlebih dahulu._`
            }, { quoted: message });
            return;
        }

        await sock.sendMessage(from, { text: '⏳ _Sedang memproses dan menyimpan catatan..._' }, { quoted: message });

        let noteContent = {
            id: Date.now(),
            title: title,
            timestamp: new Date().toISOString(),
            type: 'text'
        };

        if (quotedType === 'conversation' || quotedType === 'extendedTextMessage') {
            noteContent.type = 'text';
            noteContent.content = quotedMessage.conversation || quotedMessage.extendedTextMessage?.text || '';
        } else {
            let mediaMessage = null;
            let mediaType = null;
            let fileName = 'file';
            let mimetype = 'application/octet-stream';

            if (quotedType === 'imageMessage') {
                mediaMessage = quotedMessage.imageMessage; mediaType = 'image'; mimetype = mediaMessage.mimetype; fileName = 'image.jpg';
            } else if (quotedType === 'videoMessage') {
                mediaMessage = quotedMessage.videoMessage; mediaType = 'video'; mimetype = mediaMessage.mimetype; fileName = 'video.mp4';
            } else if (quotedType === 'documentMessage') {
                mediaMessage = quotedMessage.documentMessage; mediaType = 'document'; mimetype = mediaMessage.mimetype; fileName = mediaMessage.fileName || 'document';
            } else if (quotedType === 'audioMessage') {
                mediaMessage = quotedMessage.audioMessage; mediaType = 'audio'; mimetype = mediaMessage.mimetype; fileName = 'audio.mp3';
            }

            if (mediaMessage) {
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const uploadResult = await uploadFile(buffer, mimetype, fileName);

                noteContent.type = mediaType;
                noteContent.fileName = fileName;
                noteContent.mimetype = mimetype;
                noteContent.caption = mediaMessage.caption || '';
                noteContent.fileUrl = uploadResult.url;
                noteContent.provider = uploadResult.provider;
            }
        }

        notes[userId].push(noteContent);
        await saveNotes(notes);

        const typeEmoji = { text: '📝', image: '📷', video: '🎥', document: '📄', audio: '🎵' };

        await sock.sendMessage(from, {
            text: `✅ _${typeEmoji[noteContent.type]} Catatan "**${title}**" berhasil disimpan!_\n\n_Ketik \`.catatan\` untuk melihat daftar, atau \`.catatan ${title}\` untuk melihat isinya._`
        }, { quoted: message });

        console.log(`📝 User ${userId} saved note: "${title}" (${noteContent.type})`);

    } catch (err) {
        console.error('Error saving note:', err);
        await sock.sendMessage(from, { text: `❌ _Gagal menyimpan catatan._\n\n_Error: ${err.message}_` }, { quoted: message });
    } finally {
        setProcessing(sender, false);
    }
}

async function handleCatatan(sock, from, message, text) {
    const sender = message.key.participant || from;
    const userId = sender.split('@')[0];

    if (isProcessing(sender)) {
        await sock.sendMessage(from, { text: '⚠️ _Kamu masih memiliki permintaan yang sedang diproses. Mohon tunggu._' }, { quoted: message });
        return;
    }

    setProcessing(sender);

    try {
        const notes = await loadNotes();
        const userNotes = notes[userId] || [];

        if (userNotes.length === 0) {
            await sock.sendMessage(from, {
                text: '📭 _Kamu belum memiliki catatan._\n\n_Cara pakai:_\n_1. Reply pesan (text/foto/video/dokumen)_\n_2. Ketik `.catat <judul>`_'
            }, { quoted: message });
            return;
        }

        // Ekstrak judul yang dicari (jika ada)
        const args = text.split(' ');
        const searchTitle = args.slice(1).join(' ').trim().toLowerCase();

        // SCENARIO 1: User hanya mengetik ".catatan" (Tampilkan List)
        if (!searchTitle) {
            let listText = `📚 *DAFTAR CATATAN KAMU*\n_Total: ${userNotes.length} catatan_\n\n`;
            
            userNotes.forEach((note, index) => {
                const emoji = { text: '📝', image: '📷', video: '🎥', document: '📄', audio: '🎵' }[note.type] || '📌';
                const date = new Date(note.timestamp).toLocaleDateString('id-ID');
                listText += `${index + 1}. ${emoji} *${note.title}*\n   └ 📅 ${date}\n`;
            });

            listText += `\n💡 _Tips: Ketik \`.catatan <judul>\` untuk melihat isi catatan.\n_Contoh: \`.catatan tugas kampus\`_`;

            await sock.sendMessage(from, { text: listText }, { quoted: message });
            return;
        }

        // SCENARIO 2: User mengetik ".catatan <judul>" (Tampilkan Isi)
        const targetNote = userNotes.find(n => n.title.toLowerCase() === searchTitle);

        if (!targetNote) {
            await sock.sendMessage(from, {
                text: `❌ _Catatan dengan judul "**${searchTitle}**" tidak ditemukan._\n\n_Pastikan penulisan judul sama persis. Ketik \`.catatan\` untuk melihat daftar judul._`
            }, { quoted: message });
            return;
        }

        // Tampilkan isi catatan berdasarkan tipe
        const date = new Date(targetNote.timestamp).toLocaleString('id-ID');
        const header = `📌 *JUDUL:* ${targetNote.title}\n📅 *DISIMPAN:* ${date}\n━━━━━━━━━━━━━━━━━\n`;

        if (targetNote.type === 'text') {
            await sock.sendMessage(from, {
                text: `${header}\n${targetNote.content}`
            }, { quoted: message });
        } 
        else if (targetNote.type === 'image') {
            await sock.sendMessage(from, {
                image: { url: targetNote.fileUrl },
                caption: `${header}\n📷 *Link Gambar:* ${targetNote.fileUrl}\n☁️ *Provider:* ${targetNote.provider}\n\n${targetNote.caption || ''}`
            }, { quoted: message });
        } 
        else if (targetNote.type === 'video') {
            await sock.sendMessage(from, {
                video: { url: targetNote.fileUrl },
                caption: `${header}\n🎥 *Link Video:* ${targetNote.fileUrl}\n☁️ *Provider:* ${targetNote.provider}\n\n${targetNote.caption || ''}`
            }, { quoted: message });
        } 
        else if (targetNote.type === 'document') {
            await sock.sendMessage(from, {
                document: { url: targetNote.fileUrl },
                mimetype: targetNote.mimetype,
                fileName: targetNote.fileName,
                caption: `${header}\n📄 *Link Dokumen:* ${targetNote.fileUrl}\n☁️ *Provider:* ${targetNote.provider}`
            }, { quoted: message });
        } 
        else if (targetNote.type === 'audio') {
            await sock.sendMessage(from, {
                audio: { url: targetNote.fileUrl },
                mimetype: targetNote.mimetype,
                ptt: false,
                caption: `${header}\n🎵 *Link Audio:* ${targetNote.fileUrl}\n☁️ *Provider:* ${targetNote.provider}`
            }, { quoted: message });
        }

        console.log(`📚 User ${userId} viewed note: "${targetNote.title}"`);

    } catch (err) {
        console.error('Error fetching notes:', err);
        await sock.sendMessage(from, { text: `❌ _Gagal mengambil catatan._\n\n_Error: ${err.message}_` }, { quoted: message });
    } finally {
        setProcessing(sender, false);
    }
}

module.exports = { handleCatat, handleCatatan };