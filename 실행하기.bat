@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 프롬프트로 마이 하우스 제작 - 로컬 서버

echo ==================================================
echo    프롬프트로 마이 하우스 제작
echo ==================================================
echo.

rem ---- 파이썬 찾기 ----
set PY=
where py >nul 2>&1 && set PY=py -3
if "%PY%"=="" ( where python >nul 2>&1 && set PY=python )

if "%PY%"=="" (
  echo [!] 파이썬을 찾지 못했습니다.
  echo     index.html 을 그냥 더블클릭해서 열어 보세요.
  echo     만약 "방 만들기"에서 오류가 나면 파이썬을 설치한 뒤 이 파일을 다시 실행하세요.
  echo.
  start "" "index.html"
  pause
  exit /b
)

rem ---- 내 PC 주소 찾기 (같은 와이파이의 폰에서 접속용) ----
set LANIP=
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4"') do (
  if "%LANIP%"=="" set LANIP=%%A
)
set LANIP=%LANIP: =%

echo  이 창은 서버입니다. 수업이 끝날 때까지 켜 두세요.
echo.
echo    내 컴퓨터에서  :  http://localhost:8000
if not "%LANIP%"=="" echo    같은 와이파이 폰 :  http://%LANIP%:8000
echo.
echo  끄려면 이 창에서 Ctrl+C 를 누르거나 창을 닫으세요.
echo ==================================================
echo.

start "" "http://localhost:8000/index.html"
%PY% -m http.server 8000
pause
