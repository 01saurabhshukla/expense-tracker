// pm2 process file for the EC2 instance (docs/DEPLOYMENT.md).
//   pm2 startOrReload docs/deploy/ecosystem.config.cjs && pm2 save
//
// Sized for a 1 GB machine (with 1 GB swap):
//   - Node is started directly (not through npm) so pm2's stop signal reaches
//     it: the worker then closes gracefully, letting a running import finish;
//   - --max-old-space-size caps each process's JavaScript heap, and pm2
//     restarts a process whose total memory goes past max_memory_restart;
//   - one import at a time and small DB pools come from backend/.env
//     (WORKER_CONCURRENCY=1, DB_POOL_MAX=5).
const path = require('node:path');

// Paths relative to this file, so it works whatever folder pm2 is run from.
const backend = path.join(__dirname, '..', '..', 'backend');

module.exports = {
  apps: [
    {
      name: 'expense-api',
      cwd: backend,
      script: 'src/server.js',
      node_args: '--env-file=.env --max-old-space-size=160',
      max_memory_restart: '220M',
      kill_timeout: 10000, // let in-flight requests finish
    },
    {
      name: 'expense-worker',
      cwd: backend,
      script: 'src/worker.js',
      node_args: '--env-file=.env --max-old-space-size=256',
      max_memory_restart: '330M',
      kill_timeout: 30000, // time for the running import to finish
    },
  ],
};
