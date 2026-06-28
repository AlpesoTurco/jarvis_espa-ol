const axios = require('axios');
const { config } = require('./config');

const { url: HA_URL, token: TOKEN } = config.homeAssistant;
const { homeAssistantTimeout: HA_TIMEOUT } = config.http;

const headers = {
    Authorization: `Bearer ${TOKEN}`
};

function buildUrl(path) {
    return new URL(path, HA_URL).toString();
}

function explainHomeAssistantError(error) {
    if (error.code === 'ECONNABORTED') {
        return `Home Assistant tardo demasiado en responder en ${HA_URL}. Revisa que /api/states responda o sube HA_TIMEOUT en .env.`;
    }

    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH') {
        return `No pude conectar con Home Assistant en ${HA_URL}. Revisa que la IP y el puerto sean correctos.`;
    }

    if (error.response) {
        return `Home Assistant respondio con estado ${error.response.status}: ${error.response.statusText}`;
    }

    return error.message;
}

async function getEntities() {
    try {
        const response = await axios.get(buildUrl('/api/states'), {
            headers,
            timeout: HA_TIMEOUT
        });

        return response.data;
    } catch (error) {
        throw new Error(explainHomeAssistantError(error));
    }
}

async function callService(domain, service, payload = {}) {
    try {
        await axios.post(
            buildUrl(`/api/services/${domain}/${service}`),
            payload,
            {
                headers,
                timeout: HA_TIMEOUT
            }
        );
    } catch (error) {
        throw new Error(explainHomeAssistantError(error));
    }
}

async function controlEntity(domain, service, entityId) {
    return callService(domain, service, {
        entity_id: entityId
    });
}

async function sendNotification(message, title = 'Jarvis', data) {
    const service = config.homeAssistant.notifyService;

    if (!message) {
        return { ok: false, error: 'Falta el mensaje de la notificacion.' };
    }

    await callService('notify', service, {
        title,
        message,
        ...(data ? { data } : {})
    });

    return {
        ok: true,
        service,
        title,
        message
    };
}

module.exports = {
    getEntities,
    callService,
    controlEntity,
    sendNotification
};
