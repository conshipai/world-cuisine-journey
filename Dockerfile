FROM node:18-alpine

# Install nginx and supervisor
RUN apk add --no-cache nginx supervisor wget

# Create working directories
RUN mkdir -p /app /run/nginx /var/log/supervisor

# Setup backend
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --production || npm install --production

COPY backend/server.js ./

# Setup frontend
COPY frontend/index.html /usr/share/nginx/html/
RUN chown -R nginx:nginx /usr/share/nginx/html

# Configure nginx
RUN cat > /etc/nginx/http.d/default.conf << 'EOF'
server {
    listen 80;
    server_name localhost;
    
    # Increase timeouts for slow connections
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
    send_timeout 60s;
    
    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 50M;
    }
    
    location /health {
        proxy_pass http://127.0.0.1:3000/health;
        proxy_connect_timeout 5s;
        proxy_read_timeout 5s;
    }
}
EOF

# Create supervisor configuration
RUN cat > /etc/supervisord.conf << 'EOF'
[supervisord]
nodaemon=true
user=root
logfile=/var/log/supervisor/supervisord.log
pidfile=/var/run/supervisord.pid
loglevel=info

[program:backend]
command=node /app/server.js
directory=/app
autostart=true
autorestart=true
startretries=10
startsecs=5
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
environment=NODE_ENV="production"
priority=1

[program:nginx]
command=nginx -g "daemon off;"
autostart=true
autorestart=true
startretries=10
startsecs=5
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
priority=2
depends_on=backend
EOF

# Expose port 80
EXPOSE 80

# Create a startup script
RUN cat > /start.sh << 'EOF'
#!/bin/sh
echo "Starting Love Journey application..."
echo "MongoDB URI configured: ${MONGODB_URI:0:50}..."
exec /usr/bin/supervisord -c /etc/supervisord.conf
EOF

RUN chmod +x /start.sh

# Health check - increased timeout and start period
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD wget -q -T 5 -O /dev/null http://127.0.0.1/health || exit 1

CMD ["/start.sh"]
