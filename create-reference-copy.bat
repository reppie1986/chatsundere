@echo off
setlocal EnableExtensions

set "SOURCE=G:\chatsundere-master"
set "TARGET_ROOT=G:\chatsundere"
set "REFERENCE_ROOT=%TARGET_ROOT%\reference-copies"

echo.
echo Chatsundere reference-copy helper
echo =================================
echo.
echo Source:
echo   %SOURCE%
echo.
echo Reference root:
echo   %REFERENCE_ROOT%
echo.

if not exist "%SOURCE%\" (
  echo ERROR: Source directory does not exist.
  echo.
  pause
  exit /b 2
)

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set "STAMP=%%I"
set "DEST=%REFERENCE_ROOT%\chatsundere-reference-%STAMP%\chatsundere-master"

if not defined STAMP (
  echo ERROR: Could not generate timestamp.
  echo.
  pause
  exit /b 3
)

if exist "%DEST%\" (
  echo ERROR: Destination already exists:
  echo   %DEST%
  echo.
  pause
  exit /b 4
)

echo Destination:
echo   %DEST%
echo.
echo This copy is for source-code comparison only.
echo Generated, dependency, cache, temporary, and reference-copy directories
echo will be excluded. The original project will not be modified or deleted.
echo.

if not exist "%REFERENCE_ROOT%\" (
  mkdir "%REFERENCE_ROOT%" 2>nul
  if errorlevel 1 (
    echo ERROR: Could not create reference root:
    echo   %REFERENCE_ROOT%
    echo.
    pause
    exit /b 5
  )
)

robocopy "%SOURCE%" "%DEST%" /E /COPY:DAT /DCOPY:DAT /R:2 /W:2 /XJ ^
  /XD ^
    node_modules ^
    dist ^
    dist-node ^
    build ^
    out ^
    .turbo ^
    .next ^
    coverage ^
    .cache ^
    temp ^
    tmp ^
    logs ^
    reference-copies ^
  /XF ^
    *.log ^
    *.tmp ^
    *.cache ^
    .DS_Store ^
    Thumbs.db

set "ROBOCOPY_EXIT=%ERRORLEVEL%"

echo.
if %ROBOCOPY_EXIT% GEQ 8 (
  echo ERROR: Robocopy reported a failure. Exit code: %ROBOCOPY_EXIT%
  echo See the robocopy output above for details.
  echo.
  pause
  exit /b %ROBOCOPY_EXIT%
)

echo Reference copy completed successfully.
echo Robocopy exit code: %ROBOCOPY_EXIT%
echo.
echo Created:
echo   %DEST%
echo.
echo Note: robocopy exit codes 0 through 7 are success or non-fatal statuses.
echo.
pause
exit /b 0
