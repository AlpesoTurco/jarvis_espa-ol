const { ask, chat } = require('./groq');
const { controlEntity, sendNotification } = require('./homeassistant');
const { config } = require('./config');
const { findDevice, listDevices } = require('./deviceManager');
const reminders = require('./reminders');
const notes = require('./notes');

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
    },
    {
        type: 'function',
        function: {
            name: 'send_notification',
            description: 'Envia una notificacion push al celular configurado en Home Assistant.',
            parameters: {
                type: 'object',
                required: ['message'],
                properties: {
                    message: {
                        type: 'string',
                        description: 'Texto de la notificacion que recibira el celular.'
                    },
                    title: {
                        type: 'string',
                        description: 'Titulo corto de la notificacion. Usa Jarvis si el usuario no pide otro titulo.'
                    }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_reminder',
            description: 'Crea un recordatorio o alarma que enviara una notificacion al celular en la fecha/hora indicada.',
            parameters: {
                type: 'object',
                required: ['datetime','message'],
                properties: {
                    datetime: { type: 'string', description: 'Fecha y hora ISO o texto interpretable por Date(). Ej: 2026-06-28T09:00:00' },
                    title: { type: 'string' },
                    message: { type: 'string' },
                    meta: { type: 'object' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_reminders',
            description: 'Lista recordatorios programados',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'cancel_reminder',
            description: 'Cancela un recordatorio existente por id',
            parameters: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_note',
            description: 'Crea una nota simple almacenada localmente.',
            parameters: { type: 'object', required: ['content'], properties: { title: { type: 'string' }, content: { type: 'string' } } }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_notes',
            description: 'Lista notas creadas localmente.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_note',
            description: 'Elimina una nota por id.',
            parameters: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }
        }
    }
];

const TOOL_TIMEOUT = config.groq.toolTimeout;

function buildSystemPrompt() {
    const catalog = listDevices()
        .slice(0, 120)
        .map(device => `${device.id} | ${device.name} | ${device.state}`)
        .join('\n');

    return [
        'Eres el planificador de un agente local para Home Assistant.',
        `Fecha y hora actual local: ${new Date().toLocaleString('es-MX', { hour12: false })}.`,
        'Solo utiliza herramientas cuando sean necesarias.',
        'Si el usuario hace una pregunta general que puedes responder sin herramientas, responde normalmente.',
        'Usa get_time solo si el usuario pregunta por la hora actual.',
        'Usa get_date solo si el usuario pregunta por la fecha actual.',
        'Usa control_device si el usuario pide encender, apagar o alternar un dispositivo.',
        'Usa get_device_state solo si la pregunta tiene relacion con un dispositivo, sensor o entidad de Home Assistant.',
        'Usa send_notification si el usuario pide enviar, mandar o avisar algo al celular.',
        'Usa create_reminder para programar recordatorios o alarmas que envien notificaciones al celular en una fecha/hora.',
        'Para create_reminder, datetime debe ser ISO valido y message debe ser el texto final de la notificacion, por ejemplo "Recuerda llamar a mama".',
        'Usa list_reminders para listar recordatorios programados y cancel_reminder para borrarlos.',
        'Usa create_note para guardar notas rápidas, list_notes para verlas y delete_note para eliminarlas.',
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
            await controlEntity(device.domain, service, device.id);
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

    await controlEntity(device.domain, service, device.id);

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

async function notifyPhone(args) {
    return sendNotification(args.message, args.title || 'Jarvis');
}

async function createReminderTool(args) {
    const res = reminders.addReminder({
        title: args.title,
        message: normalizeReminderNotification(args.message),
        datetime: args.datetime,
        meta: args.meta
    });

    return res;
}

async function listRemindersTool() {
    return { ok: true, reminders: reminders.listReminders() };
}

async function cancelReminderTool(args) {
    return reminders.cancelReminder(args.id);
}

async function createNoteTool(args) {
    return notes.addNote({ title: args.title, content: args.content });
}

async function listNotesTool() {
    return { ok: true, notes: notes.listNotes() };
}

async function deleteNoteTool(args) {
    return notes.deleteNote(args.id);
}

async function executeToolCall(call) {
    const name = call.function.name;
    const args = parseArguments(call.function.arguments) || {};

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

    if (name === 'send_notification') {
        return notifyPhone(args);
    }

    if (name === 'create_reminder') return createReminderTool(args);
    if (name === 'list_reminders') return listRemindersTool(args);
    if (name === 'cancel_reminder') return cancelReminderTool(args);
    if (name === 'create_note') return createNoteTool(args);
    if (name === 'list_notes') return listNotesTool(args);
    if (name === 'delete_note') return deleteNoteTool(args);

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

    return typeof argumentsValue === 'object' ? argumentsValue : {};
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

    if (detectAction(normalizeIntentText(userText)) === 'create_reminder') {
        const reminderPlan = await buildReminderPlan(userText);

        if (reminderPlan) {
            const result = await executeToolCall({
                function: {
                    name: 'create_reminder',
                    arguments: reminderPlan
                }
            });

            return withNaturalMessage({
                ok: result.ok,
                tool_calls: [
                    {
                        tool: 'create_reminder',
                        arguments: reminderPlan,
                        result
                    }
                ]
            });
        }
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

    if (action === 'send_notification') {
        return {
            action,
            title: 'Jarvis',
            message: extractNotificationMessage(userText)
        };
    }

    if (action === 'create_reminder') {
        const datetime = parseReminderDatetime(userText);

        if (!datetime) {
            return null;
        }

        return {
            action,
            title: 'Recordatorio',
            message: extractReminderMessage(userText),
            datetime
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

function parseReminderDatetime(text) {
    const normalized = normalizeIntentText(text);
    const relativeMatch = normalized.match(/\ben\s+(\d+)\s*(segundos?|segs?|s|minutos?|mins?|min|horas?|hrs?|h|dias?|d|semanas?|sem|w)\b/);

    if (relativeMatch) {
        const amount = Number(relativeMatch[1]);
        const unit = relativeMatch[2];
        const multipliers = [
            { re: /^(segundo|segundos|seg|segs|s)$/, value: 1000 },
            { re: /^(minuto|minutos|min|mins)$/, value: 60 * 1000 },
            { re: /^(hora|horas|hr|hrs|h)$/, value: 60 * 60 * 1000 },
            { re: /^(dia|dias|d)$/, value: 24 * 60 * 60 * 1000 },
            { re: /^(semana|semanas|sem|w)$/, value: 7 * 24 * 60 * 60 * 1000 }
        ];
        const multiplier = multipliers.find(item => item.re.test(unit))?.value;

        if (multiplier) {
            return new Date(Date.now() + amount * multiplier).toISOString();
        }
    }

    const explicitDate = normalized.match(/\b(\d{4}-\d{2}-\d{2})(?:[ t](\d{1,2})(?::(\d{2}))?)?\b/);

    if (explicitDate) {
        const date = new Date(explicitDate[1]);

        if (explicitDate[2]) {
            date.setHours(Number(explicitDate[2]), Number(explicitDate[3] || 0), 0, 0);
        }

        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    const targetDate = new Date();
    let hasDay = false;

    if (/\b(pasado manana|pasadomanana)\b/.test(normalized)) {
        targetDate.setDate(targetDate.getDate() + 2);
        hasDay = true;
    } else if (/\bmanana\b/.test(normalized)) {
        targetDate.setDate(targetDate.getDate() + 1);
        hasDay = true;
    } else if (/\bhoy\b/.test(normalized)) {
        hasDay = true;
    }

    const timeMatch = normalized.match(/\b(?:a\s+las|a|en)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);

    if (timeMatch) {
        const time = parseReminderTime(timeMatch[1], timeMatch[2], timeMatch[3]);

        if (!time) {
            return null;
        }

        targetDate.setHours(time.hour, time.minute, 0, 0);

        if (!hasDay && targetDate.getTime() <= Date.now()) {
            targetDate.setDate(targetDate.getDate() + 1);
        }

        return targetDate.toISOString();
    }

    if (hasDay) {
        targetDate.setHours(9, 0, 0, 0);
        return targetDate.toISOString();
    }

    return null;
}

function parseReminderTime(hourText, minuteText, meridiem) {
    let hour = Number(hourText);
    const minute = Number(minuteText || 0);

    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
    }

    if (meridiem) {
        if (hour < 1 || hour > 12) {
            return null;
        }

        if (meridiem === 'pm' && hour < 12) hour += 12;
        if (meridiem === 'am' && hour === 12) hour = 0;
    }

    return { hour, minute };
}

async function buildReminderPlan(userText) {
    const aiPlan = await buildReminderPlanWithAi(userText);
    const localDatetime = parseReminderDatetime(userText);

    if (aiPlan) {
        const parsedAiDatetime = new Date(aiPlan.datetime);
        const datetime = localDatetime || (
            Number.isNaN(parsedAiDatetime.getTime())
                ? null
                : parsedAiDatetime.toISOString()
        );

        if (datetime) {
            return {
                title: aiPlan.title || 'Recordatorio',
                message: normalizeReminderNotification(aiPlan.message || extractReminderMessage(userText)),
                datetime,
                meta: {
                    source: 'ai',
                    original_text: userText
                }
            };
        }
    }

    if (!localDatetime) {
        return null;
    }

    return {
        title: 'Recordatorio',
        message: normalizeReminderNotification(extractReminderMessage(userText)),
        datetime: localDatetime,
        meta: {
            source: 'local_fallback',
            original_text: userText
        }
    };
}

async function buildReminderPlanWithAi(userText) {
    const now = new Date();
    const prompt = [
        'Extrae un recordatorio desde el mensaje del usuario.',
        'Devuelve solo JSON valido, sin Markdown ni explicaciones.',
        'Campos requeridos: datetime, title, message.',
        `Fecha/hora actual local: ${now.toLocaleString('es-MX', { hour12: false })}.`,
        `Fecha/hora actual ISO: ${now.toISOString()}.`,
        'datetime debe ser una fecha ISO valida.',
        'message debe ser el texto final de la notificacion en espanol natural.',
        'Si hay una accion o motivo, escribe message empezando con "Recuerda".',
        'Ejemplo usuario: "dame un recordatorio a las 7am para llamar a mama"',
        'Ejemplo JSON: {"datetime":"2026-06-29T07:00:00.000Z","title":"Recordatorio","message":"Recuerda llamar a mama"}',
        `Usuario: ${userText}`
    ].join('\n');

    try {
        return parseJsonObject(await ask(prompt));
    } catch {
        return null;
    }
}

function extractReminderMessage(text) {
    const cleaned = String(text || '')
        .replace(/[?Â¿!Â¡]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const quoteMatch = cleaned.match(/["']([^"']+)["']/);

    if (quoteMatch) {
        return quoteMatch[1].trim();
    }

    return cleaned
        .replace(/\b(puedes|puede|podrias|podria|quiero|necesito|dame|da|dime)\b/gi, ' ')
        .replace(/\b(hacer|haz|crea|crear|pon|poner|ponme|programa|programar)\b/gi, ' ')
        .replace(/\b(recordatorio|recordame|recordarme|recuerdame|recordar|alarma|avisame|avisa)\b/gi, ' ')
        .replace(/\b(hazme|hacerme|ponerme|programame|creame|recuerdame)\b/gi, ' ')
        .replace(/\ben\s+\d+\s*(segundos?|segs?|s|minutos?|mins?|min|horas?|hrs?|h|dias?|d|semanas?|sem|w)\b/gi, ' ')
        .replace(/\b(hoy|manana|pasado manana)\b/gi, ' ')
        .replace(/\b(a las|a)\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b/gi, ' ')
        .replace(/\b(que|para|por favor|de|del|el|la|los|las|un|una|me)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Recordatorio';
}

function normalizeReminderNotification(message) {
    const cleaned = String(message || '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned || /^recordatorio$/i.test(cleaned)) {
        return 'Recordatorio';
    }

    if (/^recuerda\b/i.test(cleaned)) {
        return cleaned;
    }

    return `Recuerda ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}`;
}

function buildReminderConfirmation(reminder = {}) {
    const originalText = reminder.meta?.original_text || '';
    const relativeText = extractRelativeReminderText(originalText);

    if (relativeText) {
        return `Claro que si, yo te recuerdo ${relativeText}.`;
    }

    const whenText = formatReminderWhen(reminder.datetime);
    return `Claro que si, ${whenText} te recuerdo.`;
}

function extractRelativeReminderText(text) {
    const normalized = normalizeIntentText(text);
    const relativeMatch = normalized.match(/\ben\s+(\d+)\s*(segundos?|segs?|s|minutos?|mins?|min|horas?|hrs?|h|dias?|d|semanas?|sem|w)\b/);

    if (!relativeMatch) {
        return null;
    }

    const amount = relativeMatch[1];
    const unit = relativeMatch[2];
    const unitText = {
        s: 'segundos',
        seg: 'segundos',
        segs: 'segundos',
        segundo: 'segundo',
        segundos: 'segundos',
        min: 'minutos',
        mins: 'minutos',
        minuto: 'minuto',
        minutos: 'minutos',
        h: 'horas',
        hr: 'horas',
        hrs: 'horas',
        hora: 'hora',
        horas: 'horas',
        d: 'dias',
        dia: 'dia',
        dias: 'dias',
        sem: 'semanas',
        w: 'semanas',
        semana: 'semana',
        semanas: 'semanas'
    }[unit] || unit;

    return `en ${amount} ${unitText}`;
}

function formatReminderWhen(datetime) {
    const date = new Date(datetime);

    if (Number.isNaN(date.getTime())) {
        return 'a la hora indicada';
    }

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const targetStart = new Date(date);
    targetStart.setHours(0, 0, 0, 0);
    const dayDiff = Math.round((targetStart - dayStart) / (24 * 60 * 60 * 1000));
    const timeText = new Intl.DateTimeFormat('es-MX', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: false
    }).format(date);

    if (dayDiff === 0) {
        return `hoy a las ${timeText}`;
    }

    if (dayDiff === 1) {
        return `manana a las ${timeText}`;
    }

    if (dayDiff === 2) {
        return `pasado manana a las ${timeText}`;
    }

    const dateText = new Intl.DateTimeFormat('es-MX', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
    }).format(date);

    return `el ${dateText} a las ${timeText}`;
}

function detectAction(text) {
    if (/\b(que hora es|hora actual|dime la hora|quiero la hora|hora)\b/.test(text)) {
        return 'get_time';
    }

    if (/\b(que fecha es|fecha actual|dia es hoy|que dia es|fecha)\b/.test(text)) {
        return 'get_date';
    }
function parseDatetimeFromText(text) {
    const removeAccents = s => s.normalize('NFD').replace(/[ - ]/g, '');
    const t0 = String(text || '').toLowerCase();
    const t = t0.normalize('NFD').replace(/[ - ]/g, '').replace(/[´`]/g, '').replace(/\s+/g,' ').trim();

    // helper: parse time like 19, 19:30, 7 pm, 7:30am
    function parseTimeFromMatch(hourStr, minStr, meridiem) {
        let hour = Number(hourStr);
        const minute = minStr ? Number(minStr) : 0;

        if (meridiem) {
            meridiem = meridiem.replace('.', '').toLowerCase();
            if (meridiem === 'pm' && hour < 12) hour += 12;
            if (meridiem === 'am' && hour === 12) hour = 0;
        }

        return { hour, minute };
    }

    // ISO-like or explicit date/time
    let m = t.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:?\d{0,2}Z?)/);
    if (m) return new Date(m[1]).toISOString();

    // en N segundos/minutos/horas/dias/semanas
    m = t.match(/en\s+(\d+)\s*(segundos|segundo|s)\b/);
    if (m) return new Date(Date.now() + Number(m[1]) * 1000).toISOString();

    m = t.match(/en\s+(\d+)\s*(minutos|minuto|mins|min)\b/);
    if (m) return new Date(Date.now() + Number(m[1]) * 60000).toISOString();

    m = t.match(/en\s+(\d+)\s*(horas|hora|h)\b/);
    if (m) return new Date(Date.now() + Number(m[1]) * 3600000).toISOString();

    m = t.match(/en\s+(\d+)\s*(dias|dia|d)\b/);
    if (m) return new Date(Date.now() + Number(m[1]) * 86400000).toISOString();

    m = t.match(/en\s+(\d+)\s*(semanas|semana|w)\b/);
    if (m) return new Date(Date.now() + Number(m[1]) * 7 * 86400000).toISOString();

    // pasado mañana / pasado manaña / pasado manana
    if (/pasad[oa]\s*manana|pasado\s*manana/.test(t)) {
        const dt = new Date(); dt.setDate(dt.getDate() + 2); dt.setHours(9,0,0,0); return dt.toISOString();
    }

    // manana / manana a las 7
    if (/\bmanana\b/.test(t)) {
        const timeMatch = t.match(/manana(?:.*?)(?:a las|a|en)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
        const dt = new Date(); dt.setDate(dt.getDate() + 1);
        if (timeMatch) {
            const tm = parseTimeFromMatch(timeMatch[1], timeMatch[2], timeMatch[3]);
            dt.setHours(tm.hour, tm.minute, 0, 0);
        } else {
            dt.setHours(9,0,0,0);
        }
        return dt.toISOString();
    }

    // hoy a las 09:30 or a las 9
    if (/\bhoy\b/.test(t)) {
        const timeMatch = t.match(/hoy(?:.*?)(?:a las|a|en)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
        const dt = new Date();
        if (timeMatch) {
            const tm = parseTimeFromMatch(timeMatch[1], timeMatch[2], timeMatch[3]);
            dt.setHours(tm.hour, tm.minute, 0, 0);
            if (dt.getTime() < Date.now()) dt.setDate(dt.getDate() + 1);
        } else {
            dt.setHours(9,0,0,0);
        }
        return dt.toISOString();
    }

    // al siguiente dia / al dia siguiente / siguiente dia
    if (/al\s+siguiente\s+dia|al\s+dia\s+siguiente|dia\s+siguiente/.test(t)) {
        const dt = new Date(); dt.setDate(dt.getDate() + 1); dt.setHours(9,0,0,0); return dt.toISOString();
    }

    // direct time like 'a las 7', without day -> today or tomorrow if already passed
    m = t.match(/(?:a las|a|en)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
    if (m) {
        const dt = new Date();
        const tm = parseTimeFromMatch(m[1], m[2], m[3]);
        dt.setHours(tm.hour, tm.minute, 0, 0);
        if (dt.getTime() < Date.now()) dt.setDate(dt.getDate() + 1);
        return dt.toISOString();
    }

    return null;
}

    if (/\b(lista|listar|muestra|mostrar|ver)\b/.test(text) && /\b(entidades|dispositivos|sensores|luces|switches)\b/.test(text)) {
        return 'list_entities';
    }

    if (/\b(estado|status)\b/.test(text) && /\b(jarvis|servidor|server|conexion|sistema)\b/.test(text)) {
        return 'get_server_status';
    }

    if (/\b(notifica|notificacion|avisame|avisa|enviame|mandame|manda|envia|mensaje)\b/.test(text) && /\b(celular|telefono|movil|push)\b/.test(text)) {
        return 'send_notification';
    }

    if (/\b(recordatorio|recordame|recordarme|recuerdame|recordar|alarma|alarmas)\b/.test(text)) {
        return 'create_reminder';
    }

    if (/\b(nota|notas|anota|apunta|apuntame|apuntalo)\b/.test(text)) {
        return 'create_note';
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

function extractNotificationMessage(text) {
    const cleaned = String(text || '')
        .replace(/[?¿!¡]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const quoteMatch = cleaned.match(/["']([^"']+)["']/);

    if (quoteMatch) {
        return quoteMatch[1].trim();
    }

    return cleaned
        .replace(/\b(notifica|notificacion|avisame|avisa|enviame|mandame|manda|envia|enviar|mandar|mensaje)\b/gi, ' ')
        .replace(/\b(al|a mi|mi|el|la|los|las|por|favor|celular|telefono|movil|push|que|diciendo|decir)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Mensaje de prueba de Jarvis.';
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
        'Formato para notificacion: {"action":"send_notification","title":"Jarvis","message":"Mensaje para el celular"}',
        'Formato para recordatorio: {"action":"create_reminder","datetime":"2026-06-28T19:00:00.000Z","title":"Recordatorio","message":"Recuerda llamar a mama"}',
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
        all: plan.all,
        title: plan.title,
        message: plan.message,
        datetime: plan.datetime,
        meta: plan.meta
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

    if (first.tool === 'send_notification') {
        return `Listo, envie la notificacion al celular.`;
    }

    if (first.tool === 'create_reminder') {
        return buildReminderConfirmation(first.result.reminder);
    }

    if (first.tool === 'list_reminders') {
        return `Tengo ${first.result.reminders.length} recordatorios programados.`;
    }

    if (first.tool === 'cancel_reminder') {
        return `Recordatorio cancelado.`;
    }

    if (first.tool === 'create_note') {
        return `Nota guardada.`;
    }

    if (first.tool === 'list_notes') {
        return `Tengo ${first.result.notes.length} notas.`;
    }

    if (first.tool === 'delete_note') {
        return `Nota eliminada.`;
    }

    return 'Listo.';
}

function getToolNameFromAction(action) {
    if (action === 'get_time') return 'get_time';
    if (action === 'get_date') return 'get_date';
    if (action === 'list_entities') return 'list_entities';
    if (action === 'get_server_status') return 'get_server_status';
    if (action === 'send_notification') return 'send_notification';
    if (action === 'create_reminder') return 'create_reminder';
    if (action === 'list_reminders') return 'list_reminders';
    if (action === 'cancel_reminder') return 'cancel_reminder';
    if (action === 'create_note') return 'create_note';
    if (action === 'list_notes') return 'list_notes';
    if (action === 'delete_note') return 'delete_note';
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
