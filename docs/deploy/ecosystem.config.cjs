// pm2 process file for the EC2 instance (docs/DEPLOYMENT.md, step 6).
//   pm2 start docs/deploy/ecosystem.config.cjs && pm2 save && pm2 startup
// Node is started directly (not through npm) so pm2's stop signal reaches
// it: the worker then closes gracefully, letting a running import finish.
module.exports = {
  apps: [
    {
      name: 'expense-api',
      cwd: './backend',
      script: 'src/server.js',
      node_args: '--env-file=.env',
      max_memory_restart: '400M',
    },
    {
      name: 'expense-worker',
      cwd: './backend',
      script: 'src/worker.js',
      node_args: '--env-file=.env',
      kill_timeout: 30000, // time for the running import to finish
      max_memory_restart: '600M',
    },
  ],
};
