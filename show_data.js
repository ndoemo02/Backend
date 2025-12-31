import fs from 'fs';
const d = JSON.parse(fs.readFileSync('./test_data_dump.json', 'utf-8'));

console.log('=== RESTAURACJE ===');
d.restaurants.forEach(r => console.log(`- ${r.name} | ${r.city} | ${r.cuisine_type} | ID: ${r.id.slice(0, 8)}`));

console.log('\n=== MENU SAMPLES ===');
Object.entries(d.menuSamples).forEach(([id, m]) => {
    console.log(`\n${m.restaurantName}:`);
    m.items.forEach(i => console.log(`  - ${i.name} (${i.price_pln} zł) [${i.category}]`));
});
