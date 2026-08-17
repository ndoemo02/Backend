import fs from 'fs';
import path from 'path';

const ROOT_DIR = process.cwd();
const BAD_CHAR = '\uFFFD';
const SOURCE_ROOTS = ['api', 'scripts'];

const IGNORED_DIRS = new Set([
    '.git',
    'node_modules',
    '.vercel',
    'coverage',
    'dist',
    'build',
    'tmp',
    'logs',
]);

const TEXT_EXTENSIONS = new Set([
    '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
    '.json', '.md', '.yml', '.yaml', '.env',
    '.html', '.css', '.scss', '.sql',
    '.sh', '.ps1',
]);

function shouldScanFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (TEXT_EXTENSIONS.has(ext)) return true;

    // Also scan extension-less text files such as ".env.example".
    const base = path.basename(filePath).toLowerCase();
    if (base.includes('.env')) return true;

    return false;
}

function walk(dir, files = []) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) continue;
            walk(fullPath, files);
            continue;
        }

        if (shouldScanFile(fullPath)) {
            files.push(fullPath);
        }
    }

    return files;
}

function collectSourceFiles() {
    const files = [];

    for (const relRoot of SOURCE_ROOTS) {
        const absRoot = path.join(ROOT_DIR, relRoot);
        if (fs.existsSync(absRoot)) {
            walk(absRoot, files);
        }
    }

    // Root-level config files we also want to validate.
    const rootCandidates = [
        'package.json',
        'vitest.config.js',
    ];

    for (const fileName of rootCandidates) {
        const abs = path.join(ROOT_DIR, fileName);
        if (fs.existsSync(abs) && shouldScanFile(abs)) {
            files.push(abs);
        }
    }

    return files;
}

function findOffendingLines(filePath) {
    let content = '';
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch {
        return [];
    }

    if (!content.includes(BAD_CHAR)) return [];

    const lines = content.split(/\r?\n/);
    const hits = [];
    lines.forEach((line, index) => {
        if (line.includes(BAD_CHAR)) {
            hits.push({
                line: index + 1,
                preview: line.trim().slice(0, 180),
            });
        }
    });

    return hits;
}

const files = collectSourceFiles();
const findings = [];

for (const filePath of files) {
    const hits = findOffendingLines(filePath);
    if (hits.length) {
        findings.push({ filePath, hits });
    }
}

if (findings.length === 0) {
    console.log('[scanEncoding] OK: no replacement characters found.');
    process.exit(0);
}

console.error('[scanEncoding] FAIL: replacement character found (\uFFFD)');
for (const finding of findings) {
    const rel = path.relative(ROOT_DIR, finding.filePath);
    for (const hit of finding.hits) {
        console.error(` - ${rel}:${hit.line} ${hit.preview}`);
    }
}

process.exit(1);
