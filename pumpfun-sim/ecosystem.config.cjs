// pm2 start ecosystem.config.cjs  — roda o simulador 24/7 com reinício automático
module.exports = {
  apps: [{
    name: "pumpfun-sim",
    script: "node_modules/.bin/tsx",
    args: "src/main.ts",
    cwd: __dirname,
    interpreter: "none",
    env: { NODE_ENV: "production", LOG_LEVEL: "info", LOG_JSON: "1" },
    autorestart: true,
    max_restarts: 50,
    restart_delay: 5000,
    kill_timeout: 15000,          // tempo para o encerramento gracioso fechar posições e salvar
    max_memory_restart: "600M",
    out_file: "logs/out.log",
    error_file: "logs/err.log",
    merge_logs: true,
    time: true,
  }],
};
