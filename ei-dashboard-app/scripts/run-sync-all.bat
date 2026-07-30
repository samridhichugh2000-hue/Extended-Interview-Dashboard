@echo off
setlocal
set APPDIR=C:\Users\ragha\OneDrive\Desktop\Extended Interview - Restructured\ei-dashboard-app
set LOGDIR=%APPDIR%\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set LOGFILE=%LOGDIR%\sync-all-%date:~-4%%date:~4,2%%date:~7,2%.log

cd /d "%APPDIR%"
echo Running sync:all at %date% %time% >> "%LOGFILE%"
call "C:\Program Files\nodejs\npm.cmd" run sync:all >> "%LOGFILE%" 2>&1
echo Finished with exit code %errorlevel% at %date% %time% >> "%LOGFILE%"
