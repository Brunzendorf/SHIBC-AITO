import { spawn } from 'child_process';

const proc = spawn('npx', ['vitest', 'run', '--reporter=verbose'], {
  stdio: 'inherit',
  shell: true,
});

proc.on('exit', (code) => {
  process.exit(code);
});

setTimeout(() => {
  console.log('\nTimeout reached, killing process...');
  proc.kill();
  process.exit(1);
}, 120000); // 2 minute timeout
