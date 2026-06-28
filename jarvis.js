const express = require('express');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { config } = require('./config');
const { loadDevices, listDevices } = require('./deviceManager');
const { runAgent } = require('./agent');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let ready = false;

function getLastUserMessage(messages = []) {
    const userMessages = messages.filter(message => message.role === 'user');
    return userMessages[userMessages.length - 1]?.content || '';
}

function createChatCompletion(message, model) {
    return {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content: message
                },
                finish_reason: 'stop'
            }
        ],
        usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
        }
    };
}

function writeStreamResponse(res, message, model) {
    const payload = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                delta: {
                    content: message
                },
                finish_reason: null
            }
        ]
    };

    const done = {
        id: payload.id,
        object: 'chat.completion.chunk',
        created: payload.created,
        model,
        choices: [
            {
                index: 0,
                delta: {},
                finish_reason: 'stop'
            }
        ]
    };

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    res.write(`data: ${JSON.stringify(done)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
}

app.get('/health', (req, res) => {
    res.json({
        ok: true,
        ready,
        pid: process.pid,
        model: config.server.modelName
    });
});

app.get('/voice', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'voice.html'));
});

app.get('/cert', (req, res) => {
    const certificatePath = path.join(__dirname, 'certs', 'jarvis-local.cer');

    if (!fs.existsSync(certificatePath)) {
        return res.status(404).json({ ok: false, error: 'No hay certificado local configurado.' });
    }

    return res.download(certificatePath, 'jarvis-local.cer');
});

app.post('/api/chat', async (req, res) => {
    try {
        const message = req.body.message || req.body.prompt || getLastUserMessage(req.body.messages);

        if (!message) {
            return res.status(400).json({ ok: false, error: 'Falta message, prompt o messages.' });
        }

        const result = await runAgent(message);
        return res.json(result);
    } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});

app.get('/api/entities', (req, res) => {
    const domain = req.query.domain;
    const entities = listDevices().filter(device => !domain || device.domain === domain);

    res.json({
        ok: true,
        count: entities.length,
        entities
    });
});

app.post('/api/reload-devices', async (req, res) => {
    try {
        const devices = await loadDevices();
        return res.json({
            ok: true,
            count: devices.length
        });
    } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});

app.post('/api/notify', async (req, res) => {
    try {
        const message = req.body.message || req.body.text;
        const title = req.body.title || 'Jarvis';

        if (!message) {
            return res.status(400).json({ ok: false, error: 'Falta message o text.' });
        }

        const { sendNotification } = require('./homeassistant');
        const result = await sendNotification(message, title, req.body.data);
        return res.json(result);
    } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});

app.post('/api/transcribe', express.raw({
    type: req => {
        const contentType = req.headers['content-type'] || '';
        return contentType.startsWith('audio/') || contentType === 'application/octet-stream';
    },
    limit: '20mb'
}), async (req, res) => {
    try {
        const { transcribeAudio } = require('./groq');
        const text = await transcribeAudio(req.body, req.headers['content-type']);
        return res.json({ ok: true, text });
    } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
});

app.get('/v1/models', (req, res) => {
    res.json({
        object: 'list',
        data: [
            {
                id: config.server.modelName,
                object: 'model',
                created: 0,
                owned_by: 'jarvis'
            }
        ]
    });
});

app.post('/v1/chat/completions', async (req, res) => {
    try {
        const model = req.body.model || config.server.modelName;
        const message = getLastUserMessage(req.body.messages);

        if (!message) {
            return res.status(400).json({ error: { message: 'Falta un mensaje de usuario.' } });
        }

        const result = await runAgent(message);
        const content = result.message || result.response || JSON.stringify(result);

        if (req.body.stream) {
            return writeStreamResponse(res, content, model);
        }

        return res.json(createChatCompletion(content, model));
    } catch (error) {
        return res.status(500).json({ error: { message: error.message } });
    }
});

async function start() {
    try {
        await loadDevices();
        ready = true;
    } catch (error) {
        ready = false;
        console.warn(`Jarvis inicio sin dispositivos: ${error.message}`);
    }

    const server = app.listen(config.server.port, config.server.host, () => {
        console.log(`Jarvis API lista en ${config.server.publicUrl}`);
        console.log(`Open WebUI base URL: ${config.server.publicUrl}/v1`);
    });

    server.on('error', error => {
        if (error.code === 'EADDRINUSE') {
            console.error(`El puerto ${config.server.port} ya esta en uso. Deten el otro proceso de Jarvis o cambia JARVIS_PORT.`);
            process.exit(1);
        }

        console.error(`No pude iniciar Jarvis: ${error.message}`);
        process.exit(1);
    });

    startHttpsServer();
}

function startHttpsServer() {
    if (!config.server.httpsPort || !config.server.httpsPfx) {
        return;
    }

    const pfxPath = path.resolve(__dirname, config.server.httpsPfx);

    if (!fs.existsSync(pfxPath)) {
        console.warn(`HTTPS desactivado: no encontre ${pfxPath}`);
        return;
    }

    const httpsServer = https.createServer(
        {
            pfx: fs.readFileSync(pfxPath),
            passphrase: config.server.httpsPassphrase || undefined
        },
        app
    );

    httpsServer.listen(config.server.httpsPort, config.server.host, () => {
        console.log(`Jarvis HTTPS listo en https://localhost:${config.server.httpsPort}/voice`);
    });

    httpsServer.on('error', error => {
        if (error.code === 'EADDRINUSE') {
            console.error(`El puerto HTTPS ${config.server.httpsPort} ya esta en uso. Cambia JARVIS_HTTPS_PORT.`);
            return;
        }

        console.error(`No pude iniciar HTTPS: ${error.message}`);
    });
}

start().catch(error => {
    console.error(error.message);
    process.exit(1);
});
