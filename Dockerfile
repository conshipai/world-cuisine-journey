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

# Configure nginx to listen on 8080 and proxy to 3005
RUN cat > /etc/nginx/http.d/default.conf << 'EOF'
server {
    listen 8080;
    server_name _;
    
    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://127.0.0.1:3005/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 50M;
    }
    
    location /health {
        proxy_pass http://127.0.0.1:3005/health;
    }
}
EOF

# Create startup script
RUN cat > /start.sh << 'EOF'
#!/bin/sh
set -e

echo "Starting Love Journey application..."
echo "Backend will run on port 3005"
echo "Nginx will run on port 8080"

# Start backend on port 3005
echo "Starting backend server..."
PORT=3005 node /app/server.js &
BACKEND_PID=$!

# Wait for backend to be ready
echo "Waiting for backend to start..."
for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -f http://127.0.0.1:3005/health > /dev/null 2>&1; then
        echo "Backend is ready!"
        break
    fi
    echo "Waiting for backend... ($i/10)"
    sleep 2
done

# Verify backend is running
if ! curl -f http://127.0.0.1:3005/health > /dev/null 2>&1; then
    echo "Backend failed to start!"
    exit 1
fi

# Start nginx on port 8080
echo "Starting nginx on port 8080..."
nginx -g "daemon off;" &
NGINX_PID=$!

echo "Application started successfully!"
echo "Access the app on port 8080"

# Keep container running
wait -n $BACKEND_PID $NGINX_PID
EXIT_CODE=$?

# If one exits, kill the other
kill $BACKEND_PID $NGINX_PID 2>/dev/null

exit $EXIT_CODE
EOF

RUN chmod +x /start.sh

# Expose port 8080 instead of 80
EXPOSE 8080

# Health check on port 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=5 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["/start.sh"]
