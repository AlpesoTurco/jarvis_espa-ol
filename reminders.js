const fs = require('fs');
const path = require('path');
const { sendNotification } = require('./homeassistant');

const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'reminders.json');

let reminders = [];
const timers = new Map();

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
    if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify([]));
}

function load() {
    try {
        ensureDataDir();
        const raw = fs.readFileSync(FILE, 'utf8');
        reminders = JSON.parse(raw || '[]');
    } catch (e) {
        reminders = [];
    }

    for (const r of reminders) {
        if (!r.fired) scheduleReminder(r);
    }

    return reminders;
}

function persist() {
    ensureDataDir();
    fs.writeFileSync(FILE, JSON.stringify(reminders, null, 2));
}

function generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function scheduleReminder(reminder) {
    clearScheduled(reminder.id);

    const when = new Date(reminder.datetime).getTime();
    if (Number.isNaN(when)) {
        console.warn(`Recordatorio ${reminder.id} ignorado por fecha invalida: ${reminder.datetime}`);
        return;
    }

    const now = Date.now();
    const delay = Math.max(0, when - now);

    const timeout = setTimeout(async () => {
        try {
            await sendNotification(reminder.message || 'Recordatorio', reminder.title || 'Jarvis');
        } catch (e) {
            console.error('Error enviando notificacion del recordatorio', e.message);
        }

        // mark as fired
        reminder.fired = true;
        persist();
        timers.delete(reminder.id);
    }, delay);

    timers.set(reminder.id, timeout);
}

function clearScheduled(id) {
    const t = timers.get(id);
    if (t) {
        clearTimeout(t);
        timers.delete(id);
    }
}

function addReminder({ title, message, datetime, meta } = {}) {
    if (!datetime) {
        return { ok: false, error: 'Falta datetime para el recordatorio.' };
    }

    const parsedDatetime = new Date(datetime);

    if (Number.isNaN(parsedDatetime.getTime())) {
        return { ok: false, error: 'No pude entender la fecha u hora del recordatorio.' };
    }

    const id = generateId();
    const reminder = {
        id,
        title: title || 'Recordatorio',
        message: message || title || 'Recordatorio de Jarvis',
        datetime: parsedDatetime.toISOString(),
        created_at: new Date().toISOString(),
        fired: false,
        meta: meta || {}
    };

    reminders.push(reminder);
    persist();
    scheduleReminder(reminder);

    return { ok: true, reminder };
}

function listReminders() {
    return reminders.slice().sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
}

function cancelReminder(id) {
    const idx = reminders.findIndex(r => r.id === id);
    if (idx === -1) return { ok: false, error: 'No existe el recordatorio.' };

    clearScheduled(id);
    const [removed] = reminders.splice(idx, 1);
    persist();

    return { ok: true, reminder: removed };
}

// init on require
load();

module.exports = {
    addReminder,
    listReminders,
    cancelReminder,
    _internal: { timers }
};
