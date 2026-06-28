require('dotenv').config({ quiet: true });

function cleanEnvValue(value) {
    return value?.trim().replace(/^['"]|['"];?$/g, '').replace(/;$/, '');
}

function requireEnv(name) {
    const value = cleanEnvValue(process.env[name]);

    if (!value) {
        throw new Error(`Falta ${name} en el archivo .env`);
    }

    return value;
}

function optionalEnv(name) {
    return cleanEnvValue(process.env[name]);
}

function requireNumberEnv(name) {
    const value = Number(requireEnv(name));

    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${name} debe ser un numero mayor que 0 en el archivo .env`);
    }

    return value;
}

function optionalNumberEnv(name) {
    const value = optionalEnv(name);

    if (!value) {
        return undefined;
    }

    const number = Number(value);

    if (!Number.isFinite(number) || number <= 0) {
        throw new Error(`${name} debe ser un numero mayor que 0 en el archivo .env`);
    }

    return number;
}

const config = {
    server: {
        host: requireEnv('JARVIS_HOST'),
        port: requireNumberEnv('JARVIS_PORT'),
        httpsPort: optionalNumberEnv('JARVIS_HTTPS_PORT'),
        httpsPfx: optionalEnv('JARVIS_HTTPS_PFX'),
        httpsPassphrase: optionalEnv('JARVIS_HTTPS_PASSPHRASE'),
        publicUrl: requireEnv('JARVIS_PUBLIC_URL'),
        modelName: requireEnv('JARVIS_MODEL_NAME')
    },
    homeAssistant: {
        url: requireEnv('HA_URL'),
        token: optionalEnv('HA_TOKEN') || requireEnv('TOKEN'),
        notifyService: optionalEnv('HA_NOTIFY_SERVICE') || 'mobile_app_celular'
    },
    groq: {
        apiKey: optionalEnv('GROQ_API_KEY'),
        url: requireEnv('GROQ_URL').replace(/\/+$/, ''),
        model: requireEnv('GROQ_MODEL'),
        transcriptionModel: optionalEnv('GROQ_TRANSCRIPTION_MODEL') || 'whisper-large-v3-turbo',
        timeout: requireNumberEnv('GROQ_TIMEOUT'),
        toolTimeout: requireNumberEnv('GROQ_TOOL_TIMEOUT')
    },
    http: {
        homeAssistantTimeout: requireNumberEnv('HA_TIMEOUT')
    }
};

module.exports = {
    config
};
