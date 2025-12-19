
import fs from 'fs';
const content = fs.readFileSync('test_results.txt', 'utf16le'); // Try UTF-16
fs.writeFileSync('test_results_clean.txt', content, 'utf8');
console.log(content.slice(0, 5000));
