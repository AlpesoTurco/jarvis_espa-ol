const axios = require('axios');
const { config } = require('./config');

const {
    apiKey: GROQ_API_KEY,
    url: GROQ_URL,
    model: GROQ_MODEL,
    transcriptionModel: GROQ_TRANSCRIPTION_MODEL,
    timeout: GROQ_TIMEOUT
} = config.groq;

function requireApiKey() {
    if (!GROQ_API_KEY || GROQ_API_KEY === 'PEGA_AQUI_TU_CLAVE_DE_GROQ') {
        throw new Error('Falta una GROQ_API_KEY valida en el archivo .env.');
    }
}

function explainGroqError(error, model = GROQ_MODEL) {
    const status = error.response?.status;
    const apiMessage = error.response?.data?.error?.message;

    if (status === 401) {
        return 'La GROQ_API_KEY no es valida. Genera otra clave en https://console.groq.com/keys';
    }

    if (status === 429) {
        return 'Groq alcanzo el limite gratuito. Espera un momento y vuelve a intentarlo.';
    }

    if (status === 404) {
        return `Groq no encontro el modelo "${model}". Revisa el modelo configurado en .env.`;
    }

    if (error.code === 'ECONNABORTED') {
        return 'Groq tardo demasiado en responder. Prueba otra vez o aumenta GROQ_TIMEOUT en .env.';
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        return 'No pude conectar con Groq. Revisa la conexion a Internet y GROQ_URL.';
    }

    return apiMessage || error.message;
}

async function createCompletion(messages, tools = [], timeout = GROQ_TIMEOUT) {
    requireApiKey();

    const body = {
        model: GROQ_MODEL,
        messages,
        temperature: 0,
        stream: false
    };

    if (tools.length) {
        body.tools = tools;
        body.tool_choice = 'auto';
    }

    try {
        const response = await axios.post(
            `${GROQ_URL}/chat/completions`,
            body,
            {
                timeout,
                headers: {
                    Authorization: `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const message = response.data?.choices?.[0]?.message;

        if (!message) {
            throw new Error('Groq devolvio una respuesta sin mensaje.');
        }

        return message;
    } catch (error) {
        throw new Error(explainGroqError(error));
    }
}

async function ask(prompt) {
    const message = await createCompletion([
        { role: 'user', content: prompt }
    ]);

    return message.content || '';
}

async function chat(messages, tools = [], timeout = GROQ_TIMEOUT) {
    return createCompletion(messages, tools, timeout);
}

function getAudioExtension(mimeType = '') {
    if (mimeType.includes('mp4')) return 'mp4';
    if (mimeType.includes('mpeg')) return 'mp3';
    if (mimeType.includes('wav')) return 'wav';
    if (mimeType.includes('ogg')) return 'ogg';
    return 'webm';
}

async function transcribeAudio(buffer, mimeType = 'audio/webm') {
    requireApiKey();

    if (!buffer?.length) {
        throw new Error('No recibi audio para transcribir.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GROQ_TIMEOUT);
    const form = new FormData();
    const blob = new Blob([buffer], { type: mimeType });

    form.append('file', blob, `jarvis-audio.${getAudioExtension(mimeType)}`);
    form.append('model', GROQ_TRANSCRIPTION_MODEL);
    form.append('language', 'es');
    form.append('response_format', 'json');

    try {
        const response = await fetch(`${GROQ_URL}/audio/transcriptions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${GROQ_API_KEY}`
            },
            body: form,
            signal: controller.signal
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw {
                response: {
                    status: response.status,
                    data
                }
            };
        }

        const text = data.text?.trim();

        if (!text) {
            throw new Error('Groq no devolvio texto para el audio.');
        }

        return text;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Groq tardo demasiado en transcribir el audio.');
        }

        throw new Error(explainGroqError(error, GROQ_TRANSCRIPTION_MODEL));
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = {
    ask,
    chat,
    transcribeAudio
};
