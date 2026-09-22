param([switch]$Install, [switch]$CheckUpdates)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Find-Python {
    $candidates = @('py', 'python')
    $candidates += @(Get-ChildItem -Path "$env:LOCALAPPDATA\Programs\Python\Python*\python.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
    foreach ($candidate in $candidates) {
        if (-not (Get-Command $candidate -ErrorAction SilentlyContinue)) { continue }
        $arguments = @('-c', 'import sys, sqlite3; assert sys.version_info[:3] == (3, 14, 7); print(sys.executable)')
        if ($candidate -eq 'py') { $arguments = @('-3.14') + $arguments }
        try {
            $executable = & $candidate @arguments 2>$null
            if ($LASTEXITCODE -eq 0 -and $executable) { return [string]($executable | Select-Object -Last 1) }
        } catch { continue }
    }
}

function Find-Java {
    $candidates = @('java')
    if ($env:JAVA_HOME) { $candidates += Join-Path $env:JAVA_HOME 'bin\java.exe' }
    foreach ($pattern in @(
        "$env:ProgramFiles\Eclipse Adoptium\*\bin\java.exe",
        "$env:ProgramFiles\Java\*\bin\java.exe",
        "$env:ProgramFiles\Microsoft\jdk-*\bin\java.exe",
        "$env:LOCALAPPDATA\Programs\Eclipse Adoptium\*\bin\java.exe"
    )) {
        $candidates += @(Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
    }
    foreach ($candidate in $candidates) {
        $command = Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue
        if (-not $command) { continue }
        try {
            $probe = Start-Process -FilePath $command.Source -ArgumentList '-version' -WindowStyle Hidden -Wait -PassThru
            if ($probe.ExitCode -eq 0) { return $command.Source }
        } catch { continue }
    }
}

function Invoke-Updater {
    param([string]$python)
    Write-Host 'Checking GitHub for tool updates...'
    $checkJson = & $python (Join-Path $PSScriptRoot 'updater.py') check 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Update check could not complete. Continuing with the installed version.' -ForegroundColor Yellow
        return
    }
    try { $check = $checkJson | ConvertFrom-Json } catch {
        Write-Host 'Update check returned an invalid response. Continuing.' -ForegroundColor Yellow
        return
    }
    if (-not $check.available) {
        $message = if ($check.message) { $check.message } else { "Tools are current ($($check.current))." }
        Write-Host $message
        return
    }
    Write-Host "New version $($check.latest) found. Downloading update..." -ForegroundColor Cyan
    $applyJson = & $python (Join-Path $PSScriptRoot 'updater.py') apply 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Update failed. Continuing with the installed version.' -ForegroundColor Yellow
        Write-Host ($applyJson -join [Environment]::NewLine)
        return
    }
    Write-Host "Update downloaded and installed: $($check.latest)" -ForegroundColor Green
}

try {
    $python = Find-Python
    if ($python) { Write-Host "Python 3.14.7 already found. Skipping Python installation." -ForegroundColor Green }
    if (-not $python -and $Install) {
        if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
            throw 'Install Python 3.14.7 from https://www.python.org/downloads/release/python-3147/ and then run Install and Start.bat again.'
        }
        Write-Host 'Installing Python 3.14.7. This may take a few minutes...'
        & winget install --id Python.Python.3.14 --version 3.14.7 --exact --source winget --scope user --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw 'Python installation failed. Review the installer message above.' }
        $python = Find-Python
    }
    if (-not $python) { throw 'Python 3.14.7 was not found. Run Install and Start.bat first.' }
    if ($Install) {
        $java = Find-Java
        if ($java) { Write-Host "Java already found. Skipping Java installation." -ForegroundColor Green }
        if (-not $java) {
            if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
                throw 'Java is missing. Install Java from https://adoptium.net/ and run Install and Start.bat again.'
            }
            Write-Host 'Installing Eclipse Temurin Java 21. Windows may ask for permission...'
            & winget install --id EclipseAdoptium.Temurin.21.JDK --exact --source winget --accept-package-agreements --accept-source-agreements
            if ($LASTEXITCODE -ne 0) { throw 'Java installation failed. Review the installer message above.' }
            $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + $env:Path
            $java = Find-Java
            if (-not $java) { throw 'Java could not be verified. Close this window and run Install and Start.bat again.' }
        }
        Write-Host "Java ready: $java"
        Write-Host 'Setup complete. Python and Java are ready. Starting the server...'
    }
    if ($CheckUpdates) { Invoke-Updater $python }
    & $python (Join-Path $PSScriptRoot 'launch_server.py')
    exit $LASTEXITCODE
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
