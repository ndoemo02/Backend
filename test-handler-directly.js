import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import handler from './api/admin/conversations.js';

const envPath = path.resolve(process.cwd(), '.env');
const envLocalPath = path.resolve(process.cwd(), '.env.local');

if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}
if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
}

async function test() {
    const req = {
        headers: {
            'x-admin-token': process.env.ADMIN_TOKEN
        },
        query: {
            limit: '50'
        }
    };
    const res = {
        setHeader: () => { },
        status: (s) => {
            console.log('Status code:', s);
            return res;
        },
        json: (j) => {
            console.log('JSON body:', JSON.stringify(j, null, 2));
            return res;
        }
    };

    try {
        await handler(req, res);
    } catch (e) {
        console.error('Handler error:', e);
    }
}

test();
