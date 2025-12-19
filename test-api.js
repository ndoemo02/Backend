import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';

const envPath = path.resolve(process.cwd(), '.env');
const envLocalPath = path.resolve(process.cwd(), '.env.local');

if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}
if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
}

const token = process.env.ADMIN_TOKEN;
const port = process.env.PORT || 3000;

async function test() {
    console.log('Calling /api/admin/conversations...');
    try {
        const res = await fetch(`http://localhost:${port}/api/admin/conversations`, {
            headers: { 'x-admin-token': token }
        });
        console.log('Status:', res.status);
        const json = await res.json();
        console.log('Response:', JSON.stringify(json, null, 2));
    } catch (e) {
        console.error('Fetch error:', e.message);
    }
}

test();
