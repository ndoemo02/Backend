
import fs from 'fs';

const csvPath = 'Logi debug/restaurants_rows (2).csv';
const content = fs.readFileSync(csvPath, 'utf8');

function parseCSVLine(line) {
    const result = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') inQuote = !inQuote;
        else if (char === ',' && !inQuote) {
            result.push(cur);
            cur = '';
        } else {
            cur += char;
        }
    }
    result.push(cur);
    return result;
}

const lines = content.split('\n');
const mc = lines.find(l => l.includes('Monte Carlo'));
if (mc) {
    const parts = parseCSVLine(mc);
    console.log('ID:', parts[0]);
    console.log('Name:', parts[1]);
    console.log('Lat:', parts[6]);
    console.log('Lng:', parts[7]);
}
