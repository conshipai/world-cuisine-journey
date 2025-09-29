FROM node:18-alpine

# Install nginx and curl
RUN apk add --no-cache nginx curl

# Create directories
RUN mkdir -p /app /run/nginx

# Copy and install backend
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --production
COPY backend/server.js ./

# Copy frontend
COPY frontend/index.html /usr/share/nginx/html/

# Configure nginx
RUN cat > /etc/nginx/http.d/default.conf << 'EOF'
server {
    listen 80;
    server_name _;
    
    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        client_max_body_size 50M;
    }
    
    location /health {
        proxy_pass http://127.0.0.1:3000/health;
    }
}
EOF

# Create startup script
RUN cat > /start.sh << 'EOF'
#!/bin/sh
set -e

echo "Starting backend server..."
node /app/server.js &
BACKEND_PID=$!

echo "Waiting for backend to start..."
sleep 5

# Check if backend is running
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "Backend failed to start!"
    exit 1
fi

echo "Starting nginx..."
nginx -g "daemon off;" &
NGINX_PID=$!

# Wait for either process to exit
wait -n $BACKEND_PID $NGINX_PID
EXIT_CODE=$?

# If one exits, kill the other
kill $BACKEND_PID $NGINX_PID 2>/dev/null

exit $EXIT_CODE
EOF

RUN chmod +x /start.sh

EXPOSE 80

# Simple health check - just check nginx root
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=5 \
  CMD curl -f http://localhost/ || exit 1

CMD ["/start.sh"]
