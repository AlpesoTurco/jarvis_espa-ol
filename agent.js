const { ask, chat } = require('./ollama');
const { callService } = require('./homeassistant');
const { config } = require('./config');
const { findDevice, listDevices } = require('./deviceManager');

const ACTION_SERVICES = {
    turn_on: 'turn_on',
    turn_off: 'turn_off',
    toggle: 'toggle'
};

const CONTROL_DOMAINS = new Set([
    'light',
    'switch',
    'fan',
    'media_player',
    'automation'
]);

const tools = [
    {
        type: 'function',
        function: {
            name: 'get_time',
            description: 'Obtiene la hora actual local.',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_date',
            description: 'Obtiene la fecha actual local.',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_entities',
            description: 'Lista entidades descubiertas de Home Assistant, opcionalmente filtradas por dominio.',
            parameters: {
                type: 'object',
                properties: {
                    domain: {
                        type: 'string',
                        description: 'Dominio de Home Assistant, por ejemplo light, switch, sensor o media_player.'
                    }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_server_status',
            description: 'Consulta el estado basico del agente local y las entidades cargadas.',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'control_device',
            description: 'Controla un dispositivo de Home Assistant descubierto automaticamente.',
            parameters: {
                type: 'object',
                required: ['action'],
                properties: {
                    action: {
                        type: 'string',
                        enum: ['turn_on', 'turn_off', 'toggle'],
                        description: 'Accion que se debe ejecutar.'
                    },
                    target: {
                        type: 'string',
                        description: 'Nombre natural del dispositivo, habitacion o entidad. Ejemplo: sala.'
                    },
                    domain: {
                        type: 'string',
                        enum: ['light', 'switch', 'fan', 'media_player', 'automation'],
                        description: 'Tipo de dispositivo si el usuario lo menciona.'
                    },
                    all: {
                        type: 'boolean',
                        description: 'true si el usuario pide controlar todos los dispositivos de ese dominio.'
                    }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_device_state',
            description: 'Consulta el estado de un dispositivo o sensor de Home Assistant.',
            parameters: {
                type: 'object',
                required: ['target'],
                properties: {
                    target: {
                        type: 'string',
                        description: 'Nombre natural del dispositivo, sensor o entidad.'
                    },
                    domain: {
                        type: 'string',
                        description: 'Tipo de entidad si el usuario lo menciona.'
                    }
                }
            }
        }
    }
];

const TOOL_TIMEOUT = config.ollama.toolTimeout;

function buildSystemPrompt() {
    const catalog = listDevices()
        .slice(0, 120)
        .map(device => `${device.id} | ${device.name} | ${device.state}`)
        .join('\n');

    return [
        'Eres el planificador de un agente local para Home Assistant.',
        'Solo utiliza herramientas cuando sean necesarias.',
        'Si el usuario hace una pregunta general que puedes responder sin herramientas, responde normalmente.',
        'Usa get_time solo si el usuario pregunta por la hora actual.',
        'Usa get_date solo si el usuario pregunta por la fecha actual.',
        'Usa control_device si el usuario pide encender, apagar o alternar un dispositivo.',
        'Usa get_device_state solo si la pregunta tiene relacion con un dispositivo, sensor o entidad de Home Assistant.',
        'Usa list_entities si el usuario pide ver, listar o buscar entidades/dispositivos.',
        'Usa get_server_status si el usuario pregunta si Jarvis, el servidor o la conexion estan funcionando.',
        'No uses get_device_state para matematicas, definiciones, explicaciones o conversacion general.',
        'No digas que no puedes controlar el mundo real: si hay una herramienta adecuada, llamala.',
        'Usa targets cortos en espanol, por ejemplo "sala", "cocina", "starlink".',
        'No inventes entidades. Node.js resolvera la entidad final.',
        '',
        'Ejemplos:',
        'Usuario: Que hora es? -> usa get_time.',
        'Usuario: Cuanto es 2+2? -> responde 4 sin herramientas.',
        'Usuario: Que es Docker? -> responde sin herramientas.',
        'Usuario: Apaga la luz de la sala -> usa control_device.',
        '',
        'Entidades disponibles:',
        catalog || 'No hay entidades cargadas.'
    ].join('\n');
}

async function controlDevice(args) {
    const action = args.action;
    const service = ACTION_SERVICES[action];

    if (!service) {
        return { ok: false, error: `Accion no soportada: ${action}` };
    }

    if (args.all) {
        if (!args.domain) {
            return { ok: false, error: 'Para controlar todos los dispositivos necesito un dominio.' };
        }

        const devices = listDevices().filter(device => device.domain === args.domain);

        if (!devices.length) {
            return { ok: false, error: `No encontre entidades del dominio ${args.domain}` };
        }

        for (const device of devices) {
            await callService(device.domain, service, device.id);
        }

        return {
            ok: true,
            action,
            domain: args.domain,
            count: devices.length,
            entity_ids: devices.map(device => device.id)
        };
    }

    if (!args.target) {
        return { ok: false, error: 'No se indico que dispositivo controlar.' };
    }

    const device = findDevice(args.target, args.domain);

    if (!device) {
        return { ok: false, error: `No encontre un dispositivo para "${args.target}"` };
    }

    if (!CONTROL_DOMAINS.has(device.domain)) {
        return { ok: false, error: `${device.id} es de tipo ${device.domain} y no admite ${action}` };
    }

    await callService(device.domain, service, device.id);

    return {
        ok: true,
        action,
        entity_id: device.id,
        name: device.name
    };
}

async function getDeviceState(args) {
    const device = findDevice(args.target, args.domain);

    if (!device) {
        return { ok: false, error: `No encontre un dispositivo para "${args.target}"` };
    }

    return {
        ok: true,
        entity_id: device.id,
        name: device.name,
        state: device.state
    };
}

async function getTime() {
    return {
        ok: true,
        time: new Intl.DateTimeFormat('es-MX', {
            timeStyle: 'medium',
            hour12: false
        }).format(new Date())
    };
}

async function getDate() {
    return {
        ok: true,
        date: new Intl.DateTimeFormat('es-MX', {
            dateStyle: 'full'
        }).format(new Date())
    };
}

async function listEntities(args) {
    const domain = args.domain;
    const entities = listDevices()
        .filter(device => !domain || device.domain === domain)
        .slice(0, 50)
        .map(device => ({
            entity_id: device.id,
            name: device.name,
            domain: device.domain,
            state: device.state
        }));

    return {
        ok: true,
        count: entities.length,
        entities
    };
}

async function getServerStatus() {
    const devices = listDevices();

    return {
        ok: true,
        status: 'running',
        entities_loaded: devices.length,
        controllable_entities: devices.filter(device => device.controllable).length
    };
}

async function executeToolCall(call) {
    const name = call.function.name;
    const args = parseArguments(call.function.arguments);

    if (name === 'control_device') {
        return controlDevice(args);
    }

    if (name === 'get_device_state') {
        return getDeviceState(args);
    }

    if (name === 'get_time') {
        return getTime();
    }

    if (name === 'get_date') {
        return getDate();
    }

    if (name === 'list_entities') {
        return listEntities(args);
    }

    if (name === 'get_server_status') {
        return getServerStatus();
    }

    return { ok: false, error: `Herramienta desconocida: ${name}` };
}

function parseArguments(argumentsValue) {
    if (!argumentsValue) {
        return {};
    }

    if (typeof argumentsValue === 'string') {
        try {
            return JSON.parse(argumentsValue);
        } catch {
            return {};
        }
    }

    return argumentsValue;
}

async function runAgent(userText) {
    const fastAnswer = buildFastAnswer(userText);

    if (fastAnswer) {
        return {
            ok: true,
            fast: true,
            response: fastAnswer,
            message: fastAnswer
        };
    }

    const fastPlan = buildFastPlan(userText);

    if (fastPlan) {
        const toolName = getToolNameFromAction(fastPlan.action);
        const args = { ...fastPlan };

        if (toolName !== 'control_device') {
            delete args.action;
        }

        const result = await executeToolCall({
            function: {
                name: toolName,
                arguments: args
            }
        });

        if (result.ok) {
            const agentResult = {
                ok: true,
                fast: true,
                tool_calls: [
                    {
                        tool: toolName,
                        arguments: args,
                        result
                    }
                ]
            };

            return withNaturalMessage(agentResult);
        }
    }

    const messages = [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: userText }
    ];

    let response;

    try {
        response = await chat(messages, tools, TOOL_TIMEOUT);
    } catch (error) {
        return runJsonFallback(userText, error.message);
    }

    const toolCalls = response.tool_calls || [];

    if (!toolCalls.length) {
        return {
            ok: true,
            response: response.content || '',
            message: response.content || ''
        };
    }

    const results = [];

    for (const call of toolCalls) {
        const result = await executeToolCall(call);
        results.push({
            tool: call.function.name,
            arguments: call.function.arguments || {},
            result
        });
    }

    return withNaturalMessage({
        ok: results.every(item => item.result.ok),
        tool_calls: results
    });
}

function buildFastAnswer(userText) {
    const text = normalizeIntentText(userText);
    const mathMatch = text.match(/(?:cuanto es|calcula|resultado de)?\s*(-?\d+(?:\.\d+)?)\s*([+\-*x/])\s*(-?\d+(?:\.\d+)?)/);

    if (!mathMatch) {
        return null;
    }

    const left = Number(mathMatch[1]);
    const operator = mathMatch[2];
    const right = Number(mathMatch[3]);
    let result;

    if (operator === '+') result = left + right;
    if (operator === '-') result = left - right;
    if (operator === '*' || operator === 'x') result = left * right;
    if (operator === '/') {
        if (right === 0) {
            return 'No se puede dividir entre cero.';
        }

        result = left / right;
    }

    return Number.isInteger(result) ? String(result) : String(Number(result.toFixed(6)));
}

function buildFastPlan(userText) {
    const text = normalizeIntentText(userText);
    const action = detectAction(text);

    if (!action) {
        return null;
    }

    if (['get_time', 'get_date', 'list_entities', 'get_server_status'].includes(action)) {
        return {
            action,
            domain: detectDomain(text)
        };
    }

    const domain = detectDomain(text);
    const all = detectAll(text);
    const target = extractTarget(text);

    if (!target && !all) {
        return null;
    }

    return {
        action,
        target,
        domain,
        all
    };
}

function normalizeIntentText(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[?¿!¡,.;:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function detectAction(text) {
    if (/\b(que hora es|hora actual|dime la hora|quiero la hora|hora)\b/.test(text)) {
        return 'get_time';
    }

    if (/\b(que fecha es|fecha actual|dia es hoy|que dia es|fecha)\b/.test(text)) {
        return 'get_date';
    }

    if (/\b(lista|listar|muestra|mostrar|ver)\b/.test(text) && /\b(entidades|dispositivos|sensores|luces|switches)\b/.test(text)) {
        return 'list_entities';
    }

    if (/\b(estado|status)\b/.test(text) && /\b(jarvis|servidor|server|conexion|sistema)\b/.test(text)) {
        return 'get_server_status';
    }

    if (/\b(apaga|apagar|desactiva|desactivar)\b/.test(text)) {
        return 'turn_off';
    }

    if (/\b(enciende|encender|prende|prender|activa|activar)\b/.test(text)) {
        return 'turn_on';
    }

    if (/\b(alterna|alternar|toggle|cambia|cambiar)\b/.test(text)) {
        return 'toggle';
    }

    if (/\b(estado|como esta|bateria|temperatura|humedad|consumo|energia)\b/.test(text)) {
        return 'get_state';
    }

    if (/\b(cuanto|cuanta)\b/.test(text) && /\b(bateria|temperatura|humedad|consumo|energia|power|battery|sensor)\b/.test(text)) {
        return 'get_state';
    }

    return null;
}

function detectDomain(text) {
    if (/\b(luz|luces|lampara|foco|focos)\b/.test(text)) {
        return 'light';
    }

    if (/\b(switch|interruptor|enchufe|contacto)\b/.test(text)) {
        return 'switch';
    }

    if (/\b(ventilador|fan)\b/.test(text)) {
        return 'fan';
    }

    if (/\b(tv|tele|television|media)\b/.test(text)) {
        return 'media_player';
    }

    return undefined;
}

function detectAll(text) {
    return /\b(todo|todos|toda|todas)\b/.test(text) || /\b(luces|focos)\b/.test(text);
}

function extractTarget(text) {
    return text
        .replace(/\b(apaga|apagar|desactiva|desactivar|enciende|encender|prende|prender|activa|activar|alterna|alternar|toggle|cambia|cambiar)\b/g, ' ')
        .replace(/\b(cual|cuanto|cuanta|como|esta|tiene|es|el|la|los|las|un|una|de|del|mi|mis|por favor|todo|todos|toda|todas)\b/g, ' ')
        .replace(/\b(luz|luces|lampara|foco|focos|switch|interruptor|enchufe|contacto|estado)\b/g, ' ')
        .replace(/\b(telefono|movil|cel)\b/g, 'celular')
        .replace(/\b(bateria)\b/g, 'battery')
        .replace(/\s+/g, ' ')
        .trim();
}

async function runJsonFallback(userText, reason) {
    const prompt = [
        buildSystemPrompt(),
        '',
        'Si la peticion requiere herramienta, devuelve solo JSON valido, sin Markdown, sin explicaciones.',
        'Si es conversacion general, responde normalmente.',
        'Formato para hora: {"action":"get_time"}',
        'Formato para fecha: {"action":"get_date"}',
        'Formato para listar: {"action":"list_entities","domain":"light"}',
        'Formato para estado del servidor: {"action":"get_server_status"}',
        'Formato para todas las luces: {"action":"turn_on","domain":"light","all":true}',
        'Formato para control: {"action":"turn_off","target":"sala","domain":"light"}',
        'Formato para estado: {"action":"get_state","target":"sala"}',
        '',
        `Usuario: ${userText}`
    ].join('\n');

    const raw = await ask(prompt);
    const plan = parseJsonObject(raw);

    if (!plan) {
        return {
            ok: true,
            fallback: true,
            reason,
            response: raw,
            message: raw
        };
    }

    const toolName = getToolNameFromAction(plan.action);

    if (!toolName) {
        return {
            ok: true,
            fallback: true,
            reason,
            response: raw,
            message: raw
        };
    }

    const args = {
        action: plan.action,
        target: plan.target,
        domain: plan.domain,
        all: plan.all
    };

    if (toolName !== 'control_device') {
        delete args.action;
    }

    const result = await executeToolCall({
        function: {
            name: toolName,
            arguments: args
        }
    });

    return withNaturalMessage({
        ok: result.ok,
        fallback: true,
        reason,
        tool_calls: [
            {
                tool: toolName,
                arguments: args,
                result
            }
        ]
    });
}

function withNaturalMessage(agentResult) {
    return {
        ...agentResult,
        message: buildNaturalMessage(agentResult)
    };
}

function buildNaturalMessage(agentResult) {
    if (agentResult.response) {
        return agentResult.response;
    }

    const calls = agentResult.tool_calls || [];

    if (!calls.length) {
        return agentResult.ok ? 'Listo.' : 'No pude completar la solicitud.';
    }

    if (!agentResult.ok) {
        const error = calls.find(call => call.result?.error)?.result?.error;
        return error || 'No pude completar la solicitud.';
    }

    const first = calls[0];
    const result = first.result || {};

    if (first.tool === 'get_time') {
        return `Son las ${result.time}.`;
    }

    if (first.tool === 'get_date') {
        return `Hoy es ${result.date}.`;
    }

    if (first.tool === 'get_server_status') {
        return `Jarvis esta funcionando. Tengo ${result.entities_loaded} entidades cargadas y ${result.controllable_entities} controlables.`;
    }

    if (first.tool === 'list_entities') {
        return `Encontre ${result.count} entidades.`;
    }

    if (first.tool === 'get_device_state') {
        return `${result.name} esta en ${result.state}.`;
    }

    if (first.tool === 'control_device') {
        const actionText = {
            turn_on: 'encendi',
            turn_off: 'apague',
            toggle: 'cambie'
        }[result.action] || 'controle';

        if (result.count) {
            const domainText = result.domain === 'light' ? 'luces' : `entidades ${result.domain}`;
            return `Listo, ${actionText} ${result.count} ${domainText}.`;
        }

        return `Listo, ${actionText} ${result.name}.`;
    }

    return 'Listo.';
}

function getToolNameFromAction(action) {
    if (action === 'get_time') return 'get_time';
    if (action === 'get_date') return 'get_date';
    if (action === 'list_entities') return 'list_entities';
    if (action === 'get_server_status') return 'get_server_status';
    if (action === 'get_state') return 'get_device_state';
    if (ACTION_SERVICES[action]) return 'control_device';
    return null;
}

function parseJsonObject(text) {
    const match = String(text || '').match(/\{[\s\S]*\}/);

    if (!match) {
        return null;
    }

    try {
        return JSON.parse(match[0]);
    } catch {
        return null;
    }
}

module.exports = {
    runAgent,
    buildNaturalMessage
};
