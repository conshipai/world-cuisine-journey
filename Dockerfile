FROM node:18-alpine

# Install nginx and supervisor
RUN apk add --no-cache nginx supervisor wget curl

# Create working directories
RUN mkdir -p /app /run/nginx /var/log/supervisor

# Setup backend
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --production

COPY backend/server.js ./

# Setup frontend
COPY frontend/index.html /usr/share/nginx/html/
RUN chown -R nginx:nginx /usr/share/nginx/html

# Configure nginx with a simpler config
RUN cat > /etc/nginx/http.d/default.conf << 'EOF'
server {
    listen 80;
    server_name localhost;
    
    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://localhost:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 50M;
    }
    
    location /health {
        proxy_pass http://localhost:3000/health;
        proxy_http_version 1.1;
    }
}
EOF

# Create supervisor configuration with better startup
RUN cat > /etc/supervisord.conf << 'EOF'
[supervisord]
nodaemon=true
user=root
logfile=/var/log/supervisor/supervisord.log
pidfile=/var/run/supervisord.pid

[program:backend]
command=node /app/server.js
directory=/app
autostart=true
autorestart=true
startretries=5
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
priority=1

[program:nginx]
command=nginx -g "daemon off;"
autostart=true
autorestart=true
startretries=5
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
priority=10
EOF

# Create a better startup script
RUN cat > /start.sh << 'EOF'
#!/bin/sh
echo "Starting Love Journey application..."
echo "MongoDB URI configured: ${MONGODB_URI:0:50}..."

# Start supervisord
exec /usr/bin/supervisord -c /etc/supervisord.conf
EOF

RUN chmod +x /start.sh

# Create a health check script
RUN cat > /healthcheck.sh << 'EOF'
#!/bin/sh
# Check if backend is responding
curl -f http://localhost:3000/health || exit 1
# Check if nginx is responding
curl -f http://localhost/health || exit 1
exit 0
EOF

RUN chmod +x /healthcheck.sh

# Expose port 80
EXPOSE 80

# Health check - simplified and more robust
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=5 \
  CMD /healthcheck.sh

CMD ["/start.sh"]
