const { getEntities } = require('./homeassistant');

let devices = [];

const CONTROLLABLE_DOMAINS = new Set([
    'light',
    'switch',
    'fan',
    'cover',
    'media_player',
    'climate',
    'lock',
    'scene',
    'script',
    'automation'
]);

function normalizeText(text) {
    const normalized = String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[_\-.]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return applySynonyms(normalized);
}

function applySynonyms(text) {
    return text
        .replace(/\btelefono\b/g, 'celular')
        .replace(/\bmovil\b/g, 'celular')
        .replace(/\bcel\b/g, 'celular')
        .replace(/\bbateria\b/g, 'battery')
        .replace(/\benergia\b/g, 'energy')
        .replace(/\bdescarga\b/g, 'download')
        .replace(/\bsubida\b/g, 'upload');
}

function getDomain(entityId) {
    return entityId.split('.')[0];
}

async function loadDevices() {
    const entities = await getEntities();

    devices = entities.map(entity => {
        const domain = getDomain(entity.entity_id);
        const name = entity.attributes.friendly_name || entity.entity_id;

        return {
            id: entity.entity_id,
            domain,
            name,
            normalizedName: normalizeText(`${name} ${entity.entity_id}`),
            state: entity.state,
            controllable: CONTROLLABLE_DOMAINS.has(domain)
        };
    });

    console.log(`Dispositivos cargados: ${devices.length}`);
    return devices;
}

function listDevices() {
    return devices;
}

function findDevice(text, preferredDomain) {
    const target = normalizeText(text);
    const domain = normalizeText(preferredDomain);

    const candidates = devices
        .filter(device => !domain || device.domain === domain)
        .map(device => {
            const name = device.normalizedName;
            let score = 0;

            if (name === target) score += 100;
            if (name.includes(target)) score += 50;

            for (const word of target.split(' ')) {
                if (word && name.includes(word)) score += 10;
            }

            if (device.controllable) score += 5;

            return { device, score };
        })
        .filter(candidate => candidate.score > 0)
        .sort((a, b) => b.score - a.score);

    return candidates[0]?.device || null;
}

module.exports = {
    loadDevices,
    listDevices,
    findDevice
};
