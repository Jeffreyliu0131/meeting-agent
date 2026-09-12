@echo off
REM ---------------------------------------------------------------------------
REM  Wrapper around start.ps1 for machines where PowerShell script execution
REM  is restricted (the default on most Windows installs).
REM
REM  -ExecutionPolicy Bypass applies to THIS process only. It does not change
REM  your machine or user policy, and nothing is left behind afterwards.
REM
REM  Usage:  start.cmd      (from Explorer, or from any terminal)
REM ---------------------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 (
  echo.
  echo start.ps1 exited with an error. Scroll up for details.
  pause
)
