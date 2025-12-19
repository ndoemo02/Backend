#!/usr/bin/env node
// run-brain-tests.js - Test runner for brain API cascade tests

import { spawn } from 'child_process';
import chalk from 'chalk';

console.log(chalk.bold.cyan('🧠 Brain API - Test Suite Runner\n'));

const API_URL = process.env.API_URL || 'http://localhost:3000';

console.log(chalk.gray(`Testing API at: ${API_URL}`));
console.log(chalk.gray('Starting cascade tests...\n'));

// Run vitest with cascade test file
const vitest = spawn('npx', ['vitest', 'tests/brain-cascade.test.js', '--run'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    API_URL
  }
});

vitest.on('close', (code) => {
  if (code === 0) {
    console.log(chalk.bold.green('\n✅ All tests passed!'));
  } else {
    console.log(chalk.bold.red(`\n❌ Tests failed with exit code ${code}`));
  }
  process.exit(code);
});

vitest.on('error', (err) => {
  console.error(chalk.bold.red('❌ Failed to run tests:'), err.message);
  process.exit(1);
});

