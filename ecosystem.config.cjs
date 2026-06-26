module.exports = {
  apps: [
    {
      name: 'python-sidecar',
      script: '-m uvicorn sidecar.main:app --host 127.0.0.1 --port 8001',
      interpreter: 'python3',
      autorestart: true,
      max_restarts: 10,
      error_file: '/dev/null',
      out_file: '/dev/null'
    },
    {
      name: 'node-gateway',
      script: 'index.js',
      autorestart: true,
      max_restarts: 10,
      error_file: '/dev/null',
      out_file: '/dev/null'
    }
  ]
};
