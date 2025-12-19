
import fs from 'fs';

const csvPath = 'Logi debug/menu_items_v2_rows (1).csv';
const content = fs.readFileSync(csvPath, 'utf8');
const lines = content.split('\n');
const targetId = '1fc1e782-bac6-47b2-b510-2571ccc06978';

const items = lines.filter(line => line.includes(targetId));

console.log(`Found ${items.length} items for ${targetId}`);
items.forEach(line => {
    const parts = line.split(',');
    console.log(`- Name: ${parts[2]}, Price: ${parts[4]}`);
});
