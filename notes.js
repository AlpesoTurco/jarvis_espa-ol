const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'notes.json');

let notes = [];

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
    if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify([]));
}

function load() {
    try {
        ensureDataDir();
        const raw = fs.readFileSync(FILE, 'utf8');
        notes = JSON.parse(raw || '[]');
    } catch (e) {
        notes = [];
    }

    return notes;
}

function persist() {
    ensureDataDir();
    fs.writeFileSync(FILE, JSON.stringify(notes, null, 2));
}

function generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function addNote({ title, content } = {}) {
    const id = generateId();
    const note = {
        id,
        title: title || '',
        content: content || '',
        created_at: new Date().toISOString()
    };

    notes.push(note);
    persist();

    return { ok: true, note };
}

function listNotes() {
    return notes.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function deleteNote(id) {
    const idx = notes.findIndex(n => n.id === id);
    if (idx === -1) return { ok: false, error: 'No existe la nota.' };

    const [removed] = notes.splice(idx, 1);
    persist();
    return { ok: true, note: removed };
}

// init
load();

module.exports = {
    addNote,
    listNotes,
    deleteNote
};
