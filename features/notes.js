const fs = require('fs/promises');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { setProcessing, isProcessing } = require('../utils/antiSpam');
const settings = require('../config/settings');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');

// Import AWS SDK untuk Cloudflare R2
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

// Konfigurasi Cloudinary 
cloudinary.config({
    cloud_name: settings.CLOUDINARY_CLOUD_NAME,
    api_key: settings.CLOUDINARY_API_KEY,
    api_secret: settings.CLOUDINARY_API_SECRET
});

// Konfigurasi Cloudflare R2 Client
const r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: settings.R2_ACCESS_KEY_ID,
        secretAccessKey: settings.R2_SECRET_ACCESS_KEY,
    },
});

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

// ==========================================
// FUNGSI UPLOAD KE CLOUDFLARE R2 
// ==========================================
async function uploadToR2(buffer, fileName, mimetype) {
    try {
        // Tambahkan timestamp agar nama file unik dan tidak saling overwrite
        const uniqueKey = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

        console.log(`[UPLOAD] Mengupload ke Cloudflare R2: ${uniqueKey} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

        const command = new PutObjectCommand({
            Bucket: settings.R2_BUCKET_NAME,
            Key: uniqueKey,
            Body: buffer,
            ContentType: mimetype || 'application/octet-stream',
        });

        await r2Client.send(command);

        console.log(`✅ [SUCCESS] File berhasil diupload ke R2 dengan key: ${uniqueKey}`);

        return {
            url: uniqueKey, 
            provider: 'Cloudflare R2',
            publicId: uniqueKey
        };
    } catch (err) {
        console.error('❌ R2 Upload Error:', err.message);
        throw new Error('Gagal upload ke Cloudflare R2: ' + err.message);
    }
}

// ==========================================
// 1. FITUR .CATAT
// ==========================================
async function handleCatat(sock, from, message, text, isQuoted, quotedMessage, quotedType) {
    const isGroup = from.endsWith('@g.us');
    if (!isGroup) {
        await sock.sendMessage(from, { text: ' _Fitur catatan hanya dapat digunakan di dalam grup!_' }, { quoted: message });
        return;
    }

    const sender = message.key.participant || from;
    const groupId = from;

    if (isProcessing(sender)) {
        await sock.sendMessage(from, { text: '⚠️ _Kamu masih memiliki permintaan yang sedang diproses. Mohon tunggu._' }, { quoted: message });
        return;
    }

    setProcessing(sender);

    try {
        const args = text.split(' ');
        const title = args.slice(1).join(' ').trim();

        if (!title) {
            await sock.sendMessage(from, { text: '❌ _Format salah!_\n\n_Cara pakai:_\n_Reply pesan, lalu ketik:_\n`.catat <judul catatan>`' }, { quoted: message });
            return;
        }

        if (!isQuoted) {
            await sock.sendMessage(from, { text: '❌ _Kamu wajib me-reply pesan yang ingin dicatat!_' }, { quoted: message });
            return;
        }

        const notes = await loadNotes();
        if (!notes[groupId]) notes[groupId] = [];

        const existingNote = notes[groupId].find(n => n.title.toLowerCase() === title.toLowerCase());
        if (existingNote) {
            await sock.sendMessage(from, { text: `⚠️ _Catatan dengan judul "*${title}*" sudah ada di grup ini._` }, { quoted: message });
            return;
        }

        await sock.sendMessage(from, { text: '⏳ _Sedang memproses dan mengupload ke Cloud..._' }, { quoted: message });

        let noteContent = { id: Date.now(), title: title, timestamp: new Date().toISOString(), type: 'text', savedBy: sender };
        let mediaMessage = null, mediaType = null, fileName = 'document.file', mimetype = 'application/octet-stream';

        if (quotedMessage?.documentWithCaptionMessage) {
            mediaMessage = quotedMessage.documentWithCaptionMessage.message?.documentMessage; mediaType = 'document';
        } else if (quotedMessage?.documentMessage) {
            mediaMessage = quotedMessage.documentMessage; mediaType = 'document';
        } else if (quotedMessage?.viewOnceMessageV2?.message?.documentMessage) {
            mediaMessage = quotedMessage.viewOnceMessageV2.message.documentMessage; mediaType = 'document';
        } else if (quotedMessage?.imageMessage) {
            mediaMessage = quotedMessage.imageMessage; mediaType = 'image'; mimetype = mediaMessage.mimetype || 'image/jpeg'; fileName = 'image.jpg';
        } else if (quotedMessage?.videoMessage) {
            mediaMessage = quotedMessage.videoMessage; mediaType = 'video'; mimetype = mediaMessage.mimetype || 'video/mp4'; fileName = 'video.mp4';
        } else if (quotedMessage?.audioMessage) {
            mediaMessage = quotedMessage.audioMessage; mediaType = 'audio'; mimetype = mediaMessage.mimetype || 'audio/mpeg'; fileName = 'audio.mp3';
        } else if (quotedMessage?.conversation || quotedMessage?.extendedTextMessage) {
            noteContent.type = 'text';
            noteContent.content = quotedMessage.conversation || quotedMessage.extendedTextMessage?.text || '';
        }

        if (mediaType === 'document' && mediaMessage) {
            const rawName = mediaMessage.fileName || '';
            const m = (mediaMessage.mimetype || '').toLowerCase();
            let ext = '.file';
            if (m.includes('pdf') || rawName.toLowerCase().endsWith('.pdf')) ext = '.pdf';
            else if (m.includes('wordprocessingml') || m.includes('msword') || rawName.toLowerCase().endsWith('.doc')) ext = '.docx';
            else if (m.includes('spreadsheetml') || m.includes('msexcel') || rawName.toLowerCase().endsWith('.xls')) ext = '.xlsx';
            else if (m.includes('presentationml') || m.includes('mspowerpoint') || rawName.toLowerCase().endsWith('.ppt')) ext = '.pptx';

            fileName = rawName ? (rawName.includes('.') ? rawName : rawName + ext) : `document_${Date.now()}${ext}`;
            mimetype = m;
        }

        if (mediaMessage && mediaType !== 'text') {
            console.log(`[UPLOAD] Starting download for: ${fileName}`);
            const stream = await downloadContentFromMessage(mediaMessage, mediaType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            console.log(`[UPLOAD] Download complete. Buffer size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

            const uploadResult = await uploadToR2(buffer, fileName, mimetype);

            if (!uploadResult || !uploadResult.url || !uploadResult.provider) {
                throw new Error('Data upload tidak lengkap: ' + JSON.stringify(uploadResult));
            }

            noteContent.type = mediaType;
            noteContent.fileName = fileName;
            noteContent.mimetype = mimetype;
            noteContent.caption = mediaMessage.caption || '';
            noteContent.fileUrl = uploadResult.url; // Menyimpan Key R2
            noteContent.provider = uploadResult.provider;
            noteContent.publicId = uploadResult.publicId;
        }

        notes[groupId].push(noteContent);
        await saveNotes(notes);
        console.log(`✅ [SUCCESS] Catatan "${title}" berhasil disimpan ke notes.json`);

        const typeEmoji = { text: '📝', image: '📷', video: '🎥', document: '', audio: '🎵' };
        await sock.sendMessage(from, { text: `✅ ${typeEmoji[noteContent.type]} _Catatan "*${title}*" berhasil disimpan di Cloud!_` }, { quoted: message });

    } catch (err) {
        console.error('❌ ERROR SAAT MENYIMPAN CATATAN:', err);
        await sock.sendMessage(from, { text: `❌ _Gagal menyimpan catatan._\n\n_Error: ${err.message}_` }, { quoted: message });
    } finally {
        setProcessing(sender, false);
    }
}

// ==========================================
// 2. FITUR .CATATAN
// ==========================================
async function handleCatatan(sock, from, message, text) {
    const isGroup = from.endsWith('@g.us');
    if (!isGroup) {
        await sock.sendMessage(from, { text: '❌ _Fitur catatan hanya dapat digunakan di dalam grup!_' }, { quoted: message });
        return;
    }

    const sender = message.key.participant || from;
    const groupId = from;

    if (isProcessing(sender)) {
        await sock.sendMessage(from, { text: '⚠️ _Kamu masih memiliki permintaan yang sedang diproses. Mohon tunggu._' }, { quoted: message });
        return;
    }

    setProcessing(sender);

    try {
        const notes = await loadNotes();
        const groupNotes = notes[groupId] || [];

        if (groupNotes.length === 0) {
            await sock.sendMessage(from, { text: '📭 _Belum ada catatan di grup ini._' }, { quoted: message });
            return;
        }

        const args = text.split(' ');
        const searchTitle = args.slice(1).join(' ').trim().toLowerCase();

        if (!searchTitle) {
            let listText = `📚 *DAFTAR CATATAN GRUP*\n_Total: ${groupNotes.length} catatan_\n\n`;
            groupNotes.forEach((note, index) => {
                const emoji = { text: '📝', image: '📷', video: '🎥', document: '📄', audio: '' }[note.type] || '';
                const date = new Date(note.timestamp).toLocaleDateString('id-ID');
                listText += `${index + 1}. ${emoji} *${note.title}*\n   └ 📅 ${date}\n`;
            });
            listText += `\n💡 _Tips: Ketik \`.catatan <judul>\` untuk melihat isi._`;
            await sock.sendMessage(from, { text: listText }, { quoted: message });
            return;
        }

        const targetNote = groupNotes.find(n => n.title.toLowerCase() === searchTitle);
        if (!targetNote) {
            await sock.sendMessage(from, { text: `❌ _Catatan "*${searchTitle}*" tidak ditemukan._` }, { quoted: message });
            return;
        }

        // Validasi data korup (hanya untuk non-text)
        if (targetNote.type !== 'text' && (!targetNote.fileUrl || targetNote.fileUrl === 'undefined' || !targetNote.provider)) {
            await sock.sendMessage(from, { text: `❌ _Data catatan "*${searchTitle}*" rusak/korup. Silakan hapus dan buat ulang._` }, { quoted: message });
            return;
        }

        const date = new Date(targetNote.timestamp).toLocaleString('id-ID');
        let displayCaption = `📌 *JUDUL:* ${targetNote.title}\n📅 *DISIMPAN:* ${date}\n`;

        if (targetNote.type === 'image') displayCaption += `📷 *Tipe:* Gambar\n━━━━━━━━━━━━━━━━━\n`;
        else if (targetNote.type === 'video') displayCaption += ` *Tipe:* Video\n━━━━━━━━━━━━━━━━━\n`;
        else if (targetNote.type === 'document') displayCaption += `📄 *Tipe:* Dokumen\n━━━━━━━━━━━━━━━━━\n`;
        else if (targetNote.type === 'audio') displayCaption += `🎵 *Tipe:* Audio\n━━━━━━━━━━━━━━━━━\n`;
        else if (targetNote.type === 'text') displayCaption += `📝 *Tipe:* Teks\n━━━━━━━━━━━━━━━━━\n`;

        // Tampilkan provider HANYA jika ada (untuk file, bukan text)
        if (targetNote.provider && targetNote.type !== 'text') {
            displayCaption += `☁️ *Provider:* ${targetNote.provider}\n`;
        }

        if (targetNote.caption && targetNote.caption.trim() !== '') {
            displayCaption += `\n💬 *Caption Asli:*\n${targetNote.caption}`;
        }

        if (targetNote.type === 'text') {
            // Untuk text, langsung kirim tanpa "Permintaan sedang diproses"
            await sock.sendMessage(from, { text: `${displayCaption}\n${targetNote.content}` }, { quoted: message });
        } else {
            await sock.sendMessage(from, { text: '⏳ _Permintaan sedang diproses..._' }, { quoted: message });

            try {
                let fileBuffer;

                // 🛠️ PERBAIKAN DOWNLOAD: Gunakan GetObjectCommand untuk R2, Axios untuk Cloudinary/Catbox
                if (targetNote.provider === 'Cloudflare R2') {
                    console.log(`[RETRIEVE] Mengambil file dari R2 menggunakan S3 API: ${targetNote.publicId}`);
                    const command = new GetObjectCommand({
                        Bucket: settings.R2_BUCKET_NAME,
                        Key: targetNote.publicId || targetNote.fileUrl
                    });
                    const response = await r2Client.send(command);

                    // Mengubah Stream dari R2 menjadi Buffer
                    const chunks = [];
                    for await (const chunk of response.Body) {
                        chunks.push(chunk);
                    }
                    fileBuffer = Buffer.concat(chunks);
                } else {
                    // Fallback untuk file lama di Cloudinary / Catbox
                    console.log(`[RETRIEVE] Mengambil file dari ${targetNote.provider}: ${targetNote.fileUrl}`);
                    const response = await axios.get(targetNote.fileUrl, {
                        responseType: 'arraybuffer',
                        timeout: 120000,
                        maxContentLength: 100 * 1024 * 1024,
                        maxBodyLength: 100 * 1024 * 1024,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                            'Accept': '*/*'
                        }
                    });
                    fileBuffer = Buffer.from(response.data);
                }

                console.log(`[SUCCESS] File berhasil dimuat ke buffer (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

                if (targetNote.type === 'image') await sock.sendMessage(from, { image: fileBuffer, caption: displayCaption }, { quoted: message });
                else if (targetNote.type === 'video') await sock.sendMessage(from, { video: fileBuffer, caption: displayCaption }, { quoted: message });
                else if (targetNote.type === 'document') await sock.sendMessage(from, { document: fileBuffer, mimetype: targetNote.mimetype || 'application/octet-stream', fileName: targetNote.fileName || 'document.file', caption: displayCaption }, { quoted: message });
                else if (targetNote.type === 'audio') await sock.sendMessage(from, { audio: fileBuffer, mimetype: targetNote.mimetype || 'audio/mpeg', ptt: false, caption: displayCaption }, { quoted: message });

            } catch (downloadErr) {
                console.error('[ERROR] Gagal download dari Cloud:', downloadErr.message);
                const fallbackText = targetNote.provider === 'Cloudflare R2'
                    ? `${displayCaption}\n\n️ _Gagal memuat file dari server._`
                    : `${displayCaption}\n\n⚠️ _Gagal memuat file langsung. Silakan klik link:_\n🔗 ${targetNote.fileUrl}`;

                await sock.sendMessage(from, { text: fallbackText }, { quoted: message });
            }
        }
    } catch (err) {
        console.error('Error fetching notes:', err);
        await sock.sendMessage(from, { text: `❌ _Gagal mengambil catatan._\n\n_Error: ${err.message}_` }, { quoted: message });
    } finally {
        setProcessing(sender, false);
    }
}

// ==========================================
// 3. FITUR .HAPUSCATATAN
// ==========================================
async function handleHapusCatatan(sock, from, message, text) {
    const isGroup = from.endsWith('@g.us');
    if (!isGroup) {
        await sock.sendMessage(from, { text: '❌ _Fitur catatan hanya dapat digunakan di dalam grup!_' }, { quoted: message });
        return;
    }

    const sender = message.key.participant || from;
    const groupId = from;

    if (isProcessing(sender)) {
        await sock.sendMessage(from, { text: '⚠️ _Kamu masih memiliki permintaan yang sedang diproses. Mohon tunggu._' }, { quoted: message });
        return;
    }

    setProcessing(sender);

    try {
        const args = text.split(' ');
        const searchTitle = args.slice(1).join(' ').trim().toLowerCase();

        if (!searchTitle) {
            await sock.sendMessage(from, { text: '❌ _Format salah!_\n\n_Cara pakai:_\n`.hapuscatatan <judul>`' }, { quoted: message });
            return;
        }

        const notes = await loadNotes();
        if (!notes[groupId] || notes[groupId].length === 0) {
            await sock.sendMessage(from, { text: '📭 _Belum ada catatan di grup ini._' }, { quoted: message });
            return;
        }

        const noteIndex = notes[groupId].findIndex(n => n.title.toLowerCase() === searchTitle);
        if (noteIndex === -1) {
            await sock.sendMessage(from, { text: `❌ _Catatan "*${searchTitle}*" tidak ditemukan._` }, { quoted: message });
            return;
        }

        const deletedNote = notes[groupId].splice(noteIndex, 1)[0];

        // Hapus dari Cloudinary (Untuk file lama)
        if (deletedNote.provider === 'Cloudinary' && deletedNote.publicId) {
            try {
                const resType = deletedNote.resourceType || (deletedNote.type === 'document' ? 'raw' : 'image');
                await cloudinary.uploader.destroy(deletedNote.publicId, { resource_type: resType });
                console.log(`[CLEANUP] File dihapus dari Cloudinary: ${deletedNote.publicId}`);
            } catch (e) {
                console.warn('[CLEANUP] Gagal hapus dari Cloudinary:', e.message);
            }
        }

        // Hapus dari Cloudflare R2
        if (deletedNote.provider === 'Cloudflare R2' && deletedNote.publicId) {
            try {
                const deleteCommand = new DeleteObjectCommand({
                    Bucket: settings.R2_BUCKET_NAME,
                    Key: deletedNote.publicId
                });
                await r2Client.send(deleteCommand);
                console.log(`[CLEANUP] File dihapus dari Cloudflare R2: ${deletedNote.publicId}`);
            } catch (e) {
                console.warn('[CLEANUP] Gagal hapus dari R2:', e.message);
            }
        }

        await saveNotes(notes);
        await sock.sendMessage(from, { text: `🗑️ _Catatan "*${deletedNote.title}*" berhasil dihapus!_` }, { quoted: message });
        console.log(`🗑️ Group ${groupId} deleted note: "${deletedNote.title}"`);

    } catch (err) {
        console.error('Error deleting note:', err);
        await sock.sendMessage(from, { text: `❌ _Gagal menghapus catatan._\n\n_Error: ${err.message}_` }, { quoted: message });
    } finally {
        setProcessing(sender, false);
    }
}

module.exports = { handleCatat, handleCatatan, handleHapusCatatan };