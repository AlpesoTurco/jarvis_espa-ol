const axios = require('axios');
const { config } = require('./config');

const { url: OLLAMA_URL, model: OLLAMA_MODEL, timeout: OLLAMA_TIMEOUT } = config.ollama;

function explainOllamaError(error) {
    if (error.code === 'ECONNREFUSED') {
        return `No pude conectar con Ollama en ${OLLAMA_URL}. Abre Ollama o ejecuta: ollama serve`;
    }

    if (error.response?.status === 404) {
        return `El modelo "${OLLAMA_MODEL}" no esta instalado. Ejecuta: ollama pull ${OLLAMA_MODEL}`;
    }

    if (error.code === 'ECONNABORTED') {
        return `Ollama tardo demasiado en responder. Prueba otra vez o sube OLLAMA_TIMEOUT en .env.`;
    }

    return error.message;
}

async function ask(prompt) {
    try {
        const response = await axios.post(
            `${OLLAMA_URL}/api/generate`,
            {
                model: OLLAMA_MODEL,
                prompt,
                stream: false
            },
            {
                timeout: OLLAMA_TIMEOUT
            }
        );

        return response.data.response;
    } catch (error) {
        throw new Error(explainOllamaError(error));
    }
}

async function chat(messages, tools = [], timeout = OLLAMA_TIMEOUT) {
    try {
        const response = await axios.post(
            `${OLLAMA_URL}/api/chat`,
            {
                model: OLLAMA_MODEL,
                messages,
                tools,
                stream: false,
                options: {
                    temperature: 0
                }
            },
            {
                timeout
            }
        );

        return response.data.message;
    } catch (error) {
        throw new Error(explainOllamaError(error));
    }
}

module.exports = {
    ask,
    chat
};
