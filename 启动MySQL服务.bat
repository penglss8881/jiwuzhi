@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command ""Set-Service -Name MySQL80 -StartupType Manual; Start-Service -Name MySQL80; Start-Sleep -Seconds 3; Get-Service -Name MySQL80; pause""'"

