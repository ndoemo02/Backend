
import fs from 'fs';

const csvPath = 'Logi debug/menu_items_v2_rows (1).csv';
const content = fs.readFileSync(csvPath, 'utf8');
const targetId = '83566974-1017-4408-90ee-2571ccc06978';

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
const firstItem = lines.find(line => line.includes(targetId));
if (firstItem) {
    console.log('Raw line:', firstItem);
    console.log('Parsed:', parseCSVLine(firstItem));
}
