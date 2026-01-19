
import fs from 'fs';

const csvPath = 'Logi debug/menu_items_v2_rows (1).csv';
const content = fs.readFileSync(csvPath, 'utf8');
const targetId = '83566974-1017-4408-90ee-2571ccc06978';

const items = content.split('\n').filter(line => line.includes(targetId));

console.log(`--- Monte Carlo Menu (from CSV) ---`);
items.forEach(line => {
    const parts = line.split(',');
    // some lines might have commas in descriptions, but name is usually p[2]
    console.log(`- ${parts[2]} (${parts[4]} zł)`);
});
