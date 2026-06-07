require('dotenv').config({ quiet: true });

const axios = require('axios');

function cleanEnvValue(value) {
    return value?.trim().replace(/^['"]|['"];?$/g, '').replace(/;$/, '');
}

const HA_URL = cleanEnvValue(process.env.HA_URL);
const TOKEN = cleanEnvValue(process.env.HA_TOKEN || process.env.TOKEN);

async function test() {
    if (!HA_URL) {
        throw new Error('Falta HA_URL en el archivo .env');
    }

    if (!TOKEN) {
        throw new Error('Falta HA_TOKEN o TOKEN en el archivo .env');
    }

    const url = new URL('/api/states', HA_URL).toString();
    const response = await axios.get(url, {
        headers: {
            Authorization: `Bearer ${TOKEN}`
        },
        timeout: 10000
    });

    response.data.forEach(entity => {
        console.log(entity.entity_id);
    });
}

test().catch(error => {
    if (error.response) {
        console.error(`Home Assistant respondio con estado ${error.response.status}: ${error.response.statusText}`);
    } else {
        console.error(error.message);
    }

    process.exit(1);
});
