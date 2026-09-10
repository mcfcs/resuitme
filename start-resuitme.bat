@echo off
REM ---------------------------------------------------------------------------
REM Start Resuitme on port 5581, reachable over Tailscale.
REM
REM Binds 0.0.0.0 so the tailnet IP can reach it, then prints the tailnet URL to
REM open from a phone or another machine.
REM
REM SECURITY: binding 0.0.0.0 exposes /api/* to every device that can route to
REM this host. Tailscale limits that to your own tailnet, but set
REM APP_ACCESS_TOKEN in .env.local for a real check -- see README.
REM ---------------------------------------------------------------------------

setlocal EnableDelayedExpansion
set "PORT=5581"
cd /d "%~dp0"

echo.
echo   Resuitme  --  port %PORT%
echo   ------------------------------------------------------------

REM --- Free the port -----------------------------------------------------
REM Only LISTENING sockets on this exact port, so an unrelated process with
REM 5581 as an ephemeral SOURCE port is never touched.
set "FOUND="
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  if not "%%P"=="0" (
    echo   Port %PORT% held by PID %%P -- stopping it.
    taskkill /PID %%P /F >nul 2>&1
    set "FOUND=1"
  )
)
if defined FOUND (
  REM Give Windows a moment to release the socket from TIME_WAIT.
  REM Uses ping rather than `timeout`: when this .bat is launched from Git Bash
  REM or WSL, the Unix `timeout` shadows the Windows one and errors out.
  ping -n 3 127.0.0.1 >nul
) else (
  echo   Port %PORT% is free.
)

REM --- Resolve the tailnet address ---------------------------------------
set "TSIP="
set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
if not exist "%TS%" set "TS=%ProgramFiles(x86)%\Tailscale\tailscale.exe"
if exist "%TS%" (
  for /f "tokens=1" %%I in ('"%TS%" ip -4 2^>nul') do if not defined TSIP set "TSIP=%%I"
)

REM --- Build if needed ----------------------------------------------------
if not exist ".next\BUILD_ID" (
  echo   No production build found -- building once...
  call npm run build || goto :failed
)

echo.
echo   Local     http://127.0.0.1:%PORT%
if defined TSIP (
  echo   Tailscale http://%TSIP%:%PORT%
) else (
  echo   Tailscale not detected -- LAN only.
)
echo.
echo   Ctrl+C to stop.
echo   ------------------------------------------------------------
echo.

REM -H 0.0.0.0 is what makes the tailnet address reachable; without it Next
REM binds loopback only and the Tailscale URL times out.
call npx next start -p %PORT% -H 0.0.0.0
goto :eof

:failed
echo.
echo   Build failed -- not starting. Fix the errors above and re-run.
exit /b 1
