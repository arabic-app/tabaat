// The original audit reproduction is now covered by executable regression tests.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test', path.resolve(__dirname, '../../tests/service-worker.test.cjs')], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
