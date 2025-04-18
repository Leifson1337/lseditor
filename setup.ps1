# Setup script for LS Editor
Write-Host "LS Editor Setup Script" -ForegroundColor Green

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Please run this script as Administrator" -ForegroundColor Red
    exit
}

# Check if Visual Studio Installer exists
function Test-VSInstaller {
    $vsInstallerPath = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vs_installer.exe"
    return Test-Path $vsInstallerPath
}

# Install Visual Studio Installer if not present
function Install-VSInstaller {
    Write-Host "Installing Visual Studio Installer..." -ForegroundColor Yellow
    $installerUrl = "https://aka.ms/vs/17/release/vs_installer.exe"
    $installerPath = "$env:TEMP\vs_installer.exe"
    Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath
    Start-Process -FilePath $installerPath -ArgumentList "--quiet", "--norestart" -Wait
    Remove-Item $installerPath
}

# Install required Visual Studio components
function Install-VSComponents {
    Write-Host "Installing required Visual Studio components..." -ForegroundColor Yellow
    
    # Install Visual Studio Build Tools with required components
    $vsInstallerPath = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vs_installer.exe"
    $components = @(
        "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "Microsoft.VisualStudio.Component.Windows10SDK.19041",
        "Microsoft.VisualStudio.Component.VC.Tools.x86.x64.Spectre",
        "Microsoft.VisualStudio.Component.VC.Tools.ARM64.Spectre",
        "Microsoft.VisualStudio.Component.VC.Tools.x86.x64.Spectre.v143",
        "Microsoft.VisualStudio.Component.VC.Tools.ARM64.Spectre.v143",
        "Microsoft.VisualStudio.Component.VC.Tools.x86.x64.Spectre.v143.10.0.19041.0",
        "Microsoft.VisualStudio.Component.VC.Tools.ARM64.Spectre.v143.10.0.19041.0"
    )
    
    $componentArgs = $components | ForEach-Object { "--add $_" }
    $installArgs = @(
        "--quiet",
        "--norestart",
        "--wait",
        "--nocache",
        "--installPath", "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools",
        "--add", "Microsoft.VisualStudio.Workload.VCTools",
        "--add", "Microsoft.VisualStudio.Workload.MSBuildTools"
    ) + $componentArgs
    
    Start-Process -FilePath $vsInstallerPath -ArgumentList $installArgs -Wait
}

# Main setup process
try {
    # Check and install Visual Studio Installer if needed
    if (-not (Test-VSInstaller)) {
        Install-VSInstaller
    }
    
    # Install required components
    Install-VSComponents
    
    # Install npm dependencies
    Write-Host "Installing npm dependencies..." -ForegroundColor Yellow
    npm install
    
    Write-Host "Setup completed successfully!" -ForegroundColor Green
} catch {
    Write-Host "An error occurred during setup: $_" -ForegroundColor Red
    exit 1
} 