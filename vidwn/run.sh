#!/bin/bash
# Launcher for X Video Player

cd /Users/tref/Desktop/vwall/vidwn
source venv/bin/activate
echo "Starting X Video Player server..."
python app.py &
SERVER_PID=$!
sleep 2
echo "Opening browser..."
open http://127.0.0.1:5000/
echo "Server is running. Visit http://127.0.0.1:5000/ in your browser."
echo "Press Ctrl+C to stop the server."
wait $SERVER_PID