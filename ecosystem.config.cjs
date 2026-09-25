// pm2 processes. `npx pm2 start ecosystem.config.cjs --only coattails-dev` while building;
// `coattails-web` + `coattails-worker` for the hosted demo.
module.exports = {
  apps: [
    {
      name: "coattails-dev",
      script: "node_modules/next/dist/bin/next",
      args: "dev --port 3000",
      autorestart: false,
    },
    {
      name: "coattails-web",
      script: "node_modules/next/dist/bin/next",
      args: "start --hostname 127.0.0.1 --port 3000",
      env: { NODE_ENV: "production" },
    },
    {
      name: "coattails-worker",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "--env-file=.env worker/index.ts",
      max_restarts: 20,
      restart_delay: 5000,
    },
  ],
}
