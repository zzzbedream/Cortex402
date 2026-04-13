module.exports = {
  apps: [
    {
      name: "cortex402",
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      env_production: {
        NODE_ENV: "production"
      },
      max_memory_restart: "512M",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/opt/cortex402/logs/error.log",
      out_file: "/opt/cortex402/logs/out.log",
      merge_logs: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false
    }
  ]
};
