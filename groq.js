const axios = require('axios');
const { config } = require('./config');

const {
    apiKey: GROQ_API_KEY,
    url: GROQ_URL,
    model: GROQ_MODEL,
    timeout: GROQ_TIMEOUT
} = config.groq;

function requireApiKey() {
    if (!GROQ_API_KEY || GROQ_API_KEY === 'PEGA_AQUI_TU_CLAVE_DE_GROQ') {
        throw new Error('Falta una GROQ_API_KEY valida en el archivo .env.');
    }
}

function explainGroqError(error) {
    const status = error.response?.status;
    const apiMessage = error.response?.data?.error?.message;

    if (status === 401) {
        return 'La GROQ_API_KEY no es valida. Genera otra clave en https://console.groq.com/keys';
    }

    if (status === 429) {
        return 'Groq alcanzo el limite gratuito. Espera un momento y vuelve a intentarlo.';
    }

    if (status === 404) {
        return `Groq no encontro el modelo "${GROQ_MODEL}". Revisa GROQ_MODEL en .env.`;
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

module.exports = {
    ask,
    chat
};
