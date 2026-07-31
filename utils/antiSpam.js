const processingUsers = new Map();

function isProcessing(userId) {
    return processingUsers.has(userId);
}

function setProcessing(userId, value = true) {
    if (value) {
        processingUsers.set(userId, true);
    } else {
        processingUsers.delete(userId);
    }
}

module.exports = { isProcessing, setProcessing };