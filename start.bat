@echo off
rem Double-click to play: starts the local server and opens the game.
start "" http://localhost:8080/
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port 8080
