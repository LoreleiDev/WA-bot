// utils/antiSpam.js
const userQueues = new Map();
const userLastExecTime = new Map();
const userMessageCount = new Map(); // Untuk proteksi flood/spam

// ==========================================
// KONFIGURASI KEAMANAN & ANTRIAN
// ==========================================
const MIN_COOLDOWN = 4000;      // 4 detik delay minimal untuk antrian pertama
const QUEUE_PENALTY = 2000;     // Tambah 2 detik untuk setiap antrian berikutnya (4s, 6s, 8s...)
const FLOOD_LIMIT = 5;          // Maksimal 5 command dalam...
const FLOOD_WINDOW = 10000;     // ...10 detik terakhir

/**
 * Menambahkan tugas ke antrian pengguna
 * @param {string} userId - ID pengguna (JID)
 * @param {object} task - Objek tugas { run: Function, onQueued: Function }
 */
async function enqueue(userId, task) {
    // 1. FLOOD PROTECTION (Cegah spam berlebihan)
    const now = Date.now();
    if (!userMessageCount.has(userId)) {
        userMessageCount.set(userId, []);
    }
    
    // Hapus catatan pesan yang sudah lewat 10 detik
    const recentMessages = userMessageCount.get(userId).filter(time => now - time < FLOOD_WINDOW);
    recentMessages.push(now);
    userMessageCount.set(userId, recentMessages);

    // Jika user spam lebih dari batas, tolak dan kirim peringatan
    if (recentMessages.length > FLOOD_LIMIT) {
        throw new Error('FLOOD_DETECTED');
    }

    // 2. QUEUE MANAGEMENT (Sistem Antrian)
    if (!userQueues.has(userId)) {
        userQueues.set(userId, []);
    }

    const queue = userQueues.get(userId);
    const position = queue.length;

    queue.push(task);

    if (position === 0) {
        // Jika antrian kosong, langsung jalankan processor
        runQueue(userId);
    } else {
        // Jika user sudah ada di antrian, kirim pesan "Sedang diproses"
        if (task.onQueued) {
            await task.onQueued();
        }
    }
}

// Fungsi internal untuk memproses antrian
async function runQueue(userId) {
    const queue = userQueues.get(userId);
    if (!queue) return;

    while (queue.length > 0) {
        const task = queue[0];
        
        const lastTime = userLastExecTime.get(userId) || 0;
        const timeSinceLast = Date.now() - lastTime;
        
        // Hitung delay: Antrian 1 = 4s, Antrian 2 = 6s, Antrian 3 = 8s...
        const requiredDelay = MIN_COOLDOWN + (queue.indexOf(task) * QUEUE_PENALTY);
        const waitTime = Math.max(0, requiredDelay - timeSinceLast);

        // Tunggu sesuai delay sebelum eksekusi
        if (waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        // Eksekusi tugas
        try {
            await task.run();
        } catch (err) {
            if (err.message !== 'FLOOD_DETECTED') {
                console.error(`[QUEUE ERROR] ${userId}:`, err.message);
            }
        }

        // Update waktu eksekusi terakhir dan hapus dari antrian
        userLastExecTime.set(userId, Date.now());
        queue.shift();
    }

    // Bersihkan memory jika antrian kosong
    if (queue.length === 0) {
        userQueues.delete(userId);
    }
}

module.exports = { enqueue };