const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { setProcessing, isProcessing } = require('../utils/antiSpam');

// 🎯 Path ke soffice.exe di LibreOffice Portable
// Kita pakai path.join agar aman dari masalah backslash Windows
const portableLibrePath = path.join(__dirname, '..', 'LibreOfficePortable', 'App', 'libreoffice', 'program', 'soffice.exe');

// ==========================================
// HELPER: Konversi Pakai Child Process (Anti Gagal)
// ==========================================
async function convertFileWithLibreOffice(buffer, ext, execPath) {
    return new Promise((resolve, reject) => {
        const tempDir = os.tmpdir();
        const uniqueId = Date.now();
        const inputPath = path.join(tempDir, `input_${uniqueId}.${ext}`);
        const outputPath = path.join(tempDir, `output_${uniqueId}.pdf`);

        // 1. Simpan buffer ke file sementara
        fsSync.writeFileSync(inputPath, buffer);

        // 2. Siapkan perintah untuk LibreOffice
        // --headless: jalan tanpa GUI
        // --convert-to pdf: ubah ke pdf
        // --outdir: simpan hasil di folder temp
        const args = ['--headless', '--convert-to', 'pdf', '--outdir', tempDir, inputPath];

        console.log(`[CONVERT] Menjalankan: ${execPath}`);
        console.log(`[CONVERT] Args: ${args.join(' ')}`);

        // 3. Eksekusi LibreOffice
        const child = spawn(execPath, args);

        let stderr = '';
        child.stderr.on('data', (data) => { stderr += data.toString(); });

        child.on('close', (code) => {
            // Hapus file input sementara
            try { fsSync.unlinkSync(inputPath); } catch (e) {}

            if (code !== 0) {
                reject(new Error(`LibreOffice error (code ${code}). Pastikan path soffice.exe benar.\nDetail: ${stderr}`));
                return;
            }

            // 4. Baca file PDF hasil konversi
            try {
                const pdfBuffer = fsSync.readFileSync(outputPath);
                // Hapus file output sementara
                fsSync.unlinkSync(outputPath);
                resolve(pdfBuffer);
            } catch (err) {
                reject(new Error('Gagal membaca file PDF hasil konversi. Mungkin format file tidak didukung.'));
            }
        });

        child.on('error', (err) => {
            try { fsSync.unlinkSync(inputPath); } catch (e) {}
            reject(new Error(`Tidak bisa menjalankan soffice.exe. Cek apakah file ada di: ${execPath}`));
        });
    });
}

// ==========================================
// FITUR .CONVERT (DOCX, PPTX, XLSX ke PDF)
// ==========================================
async function handleConvert(sock, from, message, text, isQuoted, quotedMessage, quotedType) {
    const sender = message.key.participant || from;

    if (isProcessing(sender)) {
        await sock.sendMessage(from, { text: '️ _Tunggu sebentar, ada proses lain yang berjalan._' }, { quoted: message });
        return;
    }

    setProcessing(sender);

    try {
        if (!isQuoted || !quotedMessage?.documentMessage) {
            await sock.sendMessage(from, { 
                text: '_Reply file dokumen yang mau diubah ke PDF!_\n\n_Hanya support: DOCX, PPTX, XLSX_' 
            }, { quoted: message });
            return;
        }

        // Cek apakah file LibreOffice Portable ada
        try {
            await fs.access(portableLibrePath);
        } catch (err) {
            throw new Error(`File LibreOffice tidak ditemukan di:\n${portableLibrePath}\n\n_Pastikan folder LibreOfficePortable ada di dalam folder utama bot._`);
        }

        await sock.sendMessage(from, { text: '⏳ _Sedang mengonversi ke PDF, mohon tunggu..._' }, { quoted: message });

        const mediaMessage = quotedMessage.documentMessage;
        const fileName = mediaMessage.fileName || 'document.file';
        const ext = path.extname(fileName).toLowerCase().replace('.', '');

        if (!['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls'].includes(ext)) {
            throw new Error('_Format tidak didukung! Gunakan DOCX, PPTX, atau XLSX._');
        }

        // Download file
        console.log(`[CONVERT] Downloading ${fileName}...`);
        const stream = await downloadContentFromMessage(mediaMessage, 'document');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        console.log(`[CONVERT] Download complete. Size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

        // Proses Konversi (Metode Badak)
        console.log(`[CONVERT] Converting ${ext} to PDF using local LibreOffice...`);
        const pdfBuffer = await convertFileWithLibreOffice(buffer, ext, portableLibrePath);
        
        const outputName = fileName.replace(/\.[^/.]+$/, '') + '.pdf';

        // Kirim hasil
        console.log(`[CONVERT] Success! Sending PDF. Size: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB`);
        await sock.sendMessage(from, { 
            document: pdfBuffer, 
            mimetype: 'application/pdf', 
            fileName: outputName,
            caption: `✅ _Berhasil dikonversi ke PDF!_\n📄 *File:* ${outputName}\n☁️ *Proses:* Lokal (Tanpa Batas)`
        }, { quoted: message });

    } catch (err) {
        console.error('❌ Convert Error:', err.message);
        await sock.sendMessage(from, { text: ` _Gagal konversi:_\n${err.message}` }, { quoted: message });
    } finally {
        setProcessing(sender, false);
    }
}

module.exports = { handleConvert };