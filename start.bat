@echo off
cd /d "%~dp0"
echo Starting game server at http://localhost:3456
echo Close this window to stop the server.
start http://localhost:3456
python -m http.server 3456
