#!/usr/bin/env pwsh
# ViewFlare One-Click Setup Script
# This script automates the entire setup process for Cloudflare Pages deployment

param(
	[string]$ProjectName = "viewflare",
	[string]$AdminPassword = $(Read-Host -Prompt "Admin Password for Dashboard"),
	[switch]$SkipAdminPassword = $false,
	[switch]$SkipDatabase = $false,
	[switch]$SkipDeploy = $false,
	[switch]$Help
)

$ErrorActionPreference = "Stop"

# Display help
if ($Help) {
	Write-Host @"
ViewFlare One-Click Setup Script

Usage: .\setup.ps1 [options]

Options:
    -ProjectName <name>     Cloudflare Pages project name (default: viewflare)
    -AdminPassword <pass>   Admin password for dashboard (will prompt if not provided)
    -SkipDatabase          Skip D1 database creation (if already exists)
    -SkipDeploy            Skip deployment step
    -Help                  Show this help message

Examples:
    .\setup.ps1
    .\setup.ps1 -ProjectName "my-counter" -AdminPassword "MySecure123!"
    .\setup.ps1 -SkipDatabase
"@
	exit 0
}

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "   ViewFlare Setup Wizard" -ForegroundColor Cyan
Write-Host "   Set-it-and-forget-it deployment" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check prerequisites
Write-Host "📋 Step 1: Checking Prerequisites..." -ForegroundColor Yellow
Write-Host ""

# Check Node.js
Write-Host "  Checking Node.js..." -NoNewline
try {
	$nodeVersion = node --version
	Write-Host " ✅ Found: $nodeVersion" -ForegroundColor Green
}
catch {
	Write-Host " ❌ Not found!" -ForegroundColor Red
	Write-Host "  Please install Node.js from https://nodejs.org/" -ForegroundColor Red
	exit 1
}

# Check npm
Write-Host "  Checking npm..." -NoNewline
try {
	$npmVersion = npm --version
	Write-Host " ✅ Found: v$npmVersion" -ForegroundColor Green
}
catch {
	Write-Host " ❌ Not found!" -ForegroundColor Red
	exit 1
}

# Check Wrangler
Write-Host "  Checking Wrangler CLI..." -NoNewline
try {
	$wranglerVersion = npx wrangler --version 2>&1 | Select-Object -First 1
	Write-Host " ✅ Found: $wranglerVersion" -ForegroundColor Green
}
catch {
	Write-Host " ⚠️  Not found, will install..." -ForegroundColor Yellow
}

Write-Host ""

# Step 2: Install dependencies
Write-Host "📦 Step 2: Installing Dependencies..." -ForegroundColor Yellow
Write-Host ""

if (!(Test-Path "node_modules")) {
	Write-Host "  Installing npm packages..." -ForegroundColor Cyan
	npm install
	if ($LASTEXITCODE -ne 0) {
		Write-Host "  ❌ Failed to install dependencies!" -ForegroundColor Red
		exit 1
	}
	Write-Host "  ✅ Dependencies installed successfully!" -ForegroundColor Green
}
else {
	Write-Host "  ✅ Dependencies already installed" -ForegroundColor Green
}

Write-Host ""

# Step 3: Cloudflare authentication
Write-Host "🔐 Step 3: Cloudflare Authentication..." -ForegroundColor Yellow
Write-Host ""

Write-Host "  Checking Cloudflare login status..." -ForegroundColor Cyan
$loginCheck = npx wrangler whoami 2>&1
if ($loginCheck -match "not authenticated" -or $loginCheck -match "error") {
	Write-Host "  ⚠️  Not logged in. Please authenticate..." -ForegroundColor Yellow
	Write-Host ""
	npx wrangler login
	if ($LASTEXITCODE -ne 0) {
		Write-Host "  ❌ Authentication failed!" -ForegroundColor Red
		exit 1
	}
}
else {
	Write-Host "  ✅ Already authenticated" -ForegroundColor Green
}

Write-Host ""

# Step 4: Create D1 Database
if (!$SkipDatabase) {
	Write-Host "🗄️  Step 4: Creating D1 Database..." -ForegroundColor Yellow
	Write-Host ""

	$dbName = "$ProjectName-db"
	Write-Host "  Creating database: $dbName" -ForegroundColor Cyan

	# Check if database already exists
	$dbList = npx wrangler d1 list 2>&1
	if ($dbList -match $dbName) {
		Write-Host "  ⚠️  Database '$dbName' already exists" -ForegroundColor Yellow
		$useExisting = Read-Host "  Use existing database? (y/n)"
		if ($useExisting -ne "y") {
			Write-Host "  Skipping database creation..." -ForegroundColor Yellow
			$SkipDatabase = $true
		}
	}

	if (!$SkipDatabase) {
		# Create database
		$dbOutput = npx wrangler d1 create $dbName 2>&1 | Out-String

		if ($dbOutput -match "database_id\s*=\s*`"([^`"]+)`"") {
			$databaseId = $matches[1]
			Write-Host "  ✅ Database created!" -ForegroundColor Green
			Write-Host "  Database ID: $databaseId" -ForegroundColor Cyan

			# Update wrangler.toml with database ID
			Write-Host "  Updating wrangler.toml..." -ForegroundColor Cyan
			$wranglerContent = Get-Content "wrangler.toml" -Raw
			$wranglerContent = $wranglerContent -replace 'database_id\s*=\s*"[^"]*"', "database_id = `"$databaseId`""
			$wranglerContent = $wranglerContent -replace 'database_name\s*=\s*"[^"]*"', "database_name = `"$dbName`""
			Set-Content "wrangler.toml" $wranglerContent -NoNewline

			# Initialize schema
			Write-Host "  Initializing database schema..." -ForegroundColor Cyan
			npx wrangler d1 execute $dbName --file=./schema.sql --remote

			if ($LASTEXITCODE -eq 0) {
				Write-Host "  ✅ Database schema initialized!" -ForegroundColor Green
			}
			else {
				Write-Host "  ⚠️  Schema initialization may have failed" -ForegroundColor Yellow
			}
		}
		else {
			Write-Host "  ❌ Failed to create database!" -ForegroundColor Red
			Write-Host "  Output: $dbOutput" -ForegroundColor Red
			exit 1
		}
	}
}
else {
	Write-Host "🗄️  Step 4: Skipping Database Creation..." -ForegroundColor Yellow
}

Write-Host ""

# Step 5: Configure environment variables
Write-Host "⚙️  Step 5: Configuring Environment..." -ForegroundColor Yellow
Write-Host ""

# Get admin password
if ([string]::IsNullOrEmpty($AdminPassword)) {
	Write-Host "  Please set an admin password for the dashboard:" -ForegroundColor Cyan
	$SecurePassword = Read-Host "  Enter password" -AsSecureString
	$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
	$AdminPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
	[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
}

if ([string]::IsNullOrEmpty($AdminPassword)) {
	Write-Host "  ⚠️  No password provided, using default" -ForegroundColor Yellow
	$AdminPassword = "ChangeMeToSecurePassword2024!"
}

Write-Host "  ✅ Admin password configured" -ForegroundColor Green
Write-Host ""

# Step 6: Deploy to Cloudflare Pages
if (!$SkipDeploy) {
	Write-Host "🚀 Step 6: Deploying to Cloudflare Pages..." -ForegroundColor Yellow
	Write-Host ""

	Write-Host "  Deploying project..." -ForegroundColor Cyan
	npx wrangler pages deploy public --project-name=$ProjectName

	if ($LASTEXITCODE -eq 0) {
		Write-Host "  ✅ Deployment successful!" -ForegroundColor Green
	}
 else {
		Write-Host "  ⚠️  Deployment may have encountered issues" -ForegroundColor Yellow
	}
}
else {
	Write-Host "🚀 Step 6: Skipping Deployment..." -ForegroundColor Yellow
}

Write-Host ""

# Step 7: Post-deployment configuration
Write-Host "🎯 Step 7: Final Configuration Steps..." -ForegroundColor Yellow
Write-Host ""

Write-Host "  You need to complete these manual steps in Cloudflare Dashboard:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1️⃣  Bind D1 Database:" -ForegroundColor Yellow
Write-Host "     → Go to: Workers & Pages → $ProjectName → Settings → Functions" -ForegroundColor White
Write-Host "     → Scroll to 'D1 database bindings'" -ForegroundColor White
Write-Host "     → Add binding: Variable name = 'DB', Database = '$ProjectName-db'" -ForegroundColor White
Write-Host ""
Write-Host "  2️⃣  Set Environment Variables:" -ForegroundColor Yellow
Write-Host "     → Go to: Workers & Pages → $ProjectName → Settings → Environment variables" -ForegroundColor White
Write-Host "     → Add: ADMIN_PASSWORD = '$AdminPassword'" -ForegroundColor White
Write-Host "     → Add: ENABLE_ADMIN = 'true'" -ForegroundColor White
Write-Host "     → Add: RATE_LIMIT_REQUESTS = '60'" -ForegroundColor White
Write-Host "     → Add: RATE_LIMIT_WINDOW = '60000'" -ForegroundColor White
Write-Host ""
Write-Host "  3️⃣  Redeploy:" -ForegroundColor Yellow
Write-Host "     → Go to: Deployments tab" -ForegroundColor White
Write-Host "     → Click 'Retry deployment' on the latest deployment" -ForegroundColor White
Write-Host ""

# Success summary
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "   ✅ Setup Complete!" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Next Steps:" -ForegroundColor Cyan
Write-Host "   1. Complete manual configuration in Cloudflare Dashboard (see above)" -ForegroundColor White
Write-Host "   2. Test your deployment:" -ForegroundColor White
Write-Host "      → Health: https://$ProjectName.pages.dev/health" -ForegroundColor White
Write-Host "      → Track view: curl -X POST https://$ProjectName.pages.dev/api/views/test" -ForegroundColor White
Write-Host "      → Badge: https://$ProjectName.pages.dev/api/views/test/badge" -ForegroundColor White
Write-Host ""
Write-Host "📚 Documentation:" -ForegroundColor Cyan
Write-Host "   → Setup Guide: ./SETUP.md" -ForegroundColor White
Write-Host "   → API Docs: ./docs/api/README.md" -ForegroundColor White
Write-Host "   → Database Binding: ./DATABASE-BINDING.md" -ForegroundColor White
Write-Host ""
Write-Host "🎉 Your view counter is ready to use!" -ForegroundColor Green
Write-Host ""
