@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 깃허브에 올리기

if not exist ".git" (
  git init
  git symbolic-ref HEAD refs/heads/main
  git remote add origin https://github.com/dejavu3650725/myhouse.git
  git config core.fileMode false
  git config core.autocrlf false
  git config core.quotepath false
  git config i18n.commitEncoding utf-8
  git config user.name "dejavu3650725"
  git config user.email "dejavu3650725@gmail.com"
)

git add -A
git diff --cached --quiet || git commit -m "수업 도구 업데이트"
git push -u origin main

if errorlevel 1 (
  echo.
  echo [!] 올리기에 실패했습니다.
  echo     로그인 창을 취소했다면 이 파일을 다시 실행해 주세요.
  echo     저장소에 이미 다른 내용이 있다면 아래를 한 번 실행한 뒤 다시 시도하세요.
  echo         git pull origin main --allow-unrelated-histories
  echo.
  pause
) else (
  echo.
  echo  완료! https://github.com/dejavu3650725/myhouse
  timeout /t 3 >nul
)
