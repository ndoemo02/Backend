
import fs from 'fs';
const content = fs.readFileSync('Logi debug/restaurants_rows (2).csv', 'utf8');
const lines = content.split('\n');
const header = lines[0].split(',');
const mc = lines.find(l => l.includes('Monte Carlo'));
if (mc) {
    const parts = mc.split(',');
    header.forEach((h, i) => {
        console.log(`${h}: ${parts[i]}`);
    });
}
