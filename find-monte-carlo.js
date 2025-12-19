
import fs from 'fs';
import path from 'path';

const csvPath = 'Logi debug/menu_items_v2_rows (1).csv';
const content = fs.readFileSync(csvPath, 'utf8');
const lines = content.split('\n');
const header = lines[0].split(',');

const monteCarloItems = lines.filter(line => line.toLowerCase().includes('pizza') || line.toLowerCase().includes('monte carlo'));

console.log('Header:', header.join(' | '));
console.log('Found:', monteCarloItems.length, 'potential items');
monteCarloItems.slice(0, 10).forEach(line => console.log(line));
