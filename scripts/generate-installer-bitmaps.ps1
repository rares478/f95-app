# Generates NSIS/WiX installer bitmaps from src-tauri/icons/icon.png
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$iconPath = Join-Path $root 'src-tauri\icons\icon.png'
$outDir = Join-Path $root 'src-tauri\windows\installer'

if (-not (Test-Path $iconPath)) {
  throw "Icon not found: $iconPath"
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-NsisBitmap {
  param(
    [int]$Width,
    [int]$Height,
    [string]$FileName,
    [bool]$ShowTitle = $false,
    [bool]$LargeIcon = $false
  )

  $bmp = New-Object System.Drawing.Bitmap $Width, $Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $bgTop = [System.Drawing.Color]::FromArgb(255, 20, 20, 20)
  $bgBottom = [System.Drawing.Color]::FromArgb(255, 14, 14, 14)
  $accent = [System.Drawing.Color]::FromArgb(255, 224, 68, 76)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
    (New-Object System.Drawing.Rectangle 0, 0, $Width, $Height),
    $bgTop,
    $bgBottom,
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
  )
  $g.FillRectangle($brush, 0, 0, $Width, $Height)
  $brush.Dispose()

  $accentHeight = [Math]::Max(3, [int]($Height * 0.04))
  $accentBrush = New-Object System.Drawing.SolidBrush $accent
  $g.FillRectangle($accentBrush, 0, 0, $Width, $accentHeight)
  $accentBrush.Dispose()

  $icon = [System.Drawing.Image]::FromFile($iconPath)
  $iconSize = if ($LargeIcon) { [Math]::Min($Width, $Height) * 0.42 } else { [Math]::Min($Width, $Height) * 0.72 }
  $iconSize = [int][Math]::Min($iconSize, [Math]::Min($icon.Width, $icon.Height))
  $ix = [int](($Width - $iconSize) / 2)
  $iy = if ($ShowTitle) { [int]($Height * 0.22) } else { [int](($Height - $iconSize) / 2) }
  $g.DrawImage($icon, $ix, $iy, $iconSize, $iconSize)

  if ($ShowTitle) {
    $fontSize = [Math]::Max(10, [int]($Height * 0.07))
    $font = [System.Drawing.Font]::new('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Near
    $titleY = $iy + $iconSize + [int]($Height * 0.04)
    $textRect = [System.Drawing.RectangleF]::new(0.0, [float]$titleY, [float]$Width, [float]($Height - $titleY))
    $g.DrawString('F95 App', $font, $textBrush, $textRect, $format)
    $font.Dispose()
    $textBrush.Dispose()
    $format.Dispose()
  }

  $icon.Dispose()
  $g.Dispose()

  $path = Join-Path $outDir $FileName
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bmp.Dispose()
  Write-Host "Wrote $path (${Width}x${Height})"
}

# WiX draws black title/body text ON TOP of these bitmaps (not beside them).
# Keep a light panel on the right where labels are rendered.
function New-WixBannerBitmap {
  param([string]$FileName)

  $width = 493
  $height = 58
  $bmp = New-Object System.Drawing.Bitmap $width, $height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

  $light = [System.Drawing.Color]::FromArgb(255, 245, 245, 245)
  $accent = [System.Drawing.Color]::FromArgb(255, 224, 68, 76)
  $brand = [System.Drawing.Color]::FromArgb(255, 26, 26, 26)

  $g.Clear($light)

  $accentBrush = New-Object System.Drawing.SolidBrush $accent
  $g.FillRectangle($accentBrush, 0, 0, $width, 4)
  $accentBrush.Dispose()

  $brandWidth = 120
  $brandBrush = New-Object System.Drawing.SolidBrush $brand
  $g.FillRectangle($brandBrush, 0, 4, $brandWidth, $height - 4)
  $brandBrush.Dispose()

  $icon = [System.Drawing.Image]::FromFile($iconPath)
  $iconSize = 40
  $g.DrawImage($icon, 12, [int](($height - $iconSize) / 2), $iconSize, $iconSize)
  $icon.Dispose()
  $g.Dispose()

  $path = Join-Path $outDir $FileName
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bmp.Dispose()
  Write-Host "Wrote $path (${width}x${height})"
}

function New-WixDialogBitmap {
  param([string]$FileName)

  $width = 493
  $height = 312
  $textPanelX = 128

  $bmp = New-Object System.Drawing.Bitmap $width, $height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $light = [System.Drawing.Color]::FromArgb(255, 245, 245, 245)
  $bgTop = [System.Drawing.Color]::FromArgb(255, 26, 26, 26)
  $bgBottom = [System.Drawing.Color]::FromArgb(255, 14, 14, 14)
  $accent = [System.Drawing.Color]::FromArgb(255, 224, 68, 76)

  $g.Clear($light)

  $brandRect = New-Object System.Drawing.Rectangle 0, 0, $textPanelX, $height
  $brandBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
    $brandRect,
    $bgTop,
    $bgBottom,
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
  )
  $g.FillRectangle($brandBrush, $brandRect)
  $brandBrush.Dispose()

  $accentBrush = New-Object System.Drawing.SolidBrush $accent
  $g.FillRectangle($accentBrush, 0, 0, $textPanelX, 4)
  $accentBrush.Dispose()

  $icon = [System.Drawing.Image]::FromFile($iconPath)
  $iconSize = [int]([Math]::Min($textPanelX * 0.72, 96))
  $ix = [int](($textPanelX - $iconSize) / 2)
  $iy = [int](($height - $iconSize) / 2)
  $g.DrawImage($icon, $ix, $iy, $iconSize, $iconSize)
  $icon.Dispose()
  $g.Dispose()

  $path = Join-Path $outDir $FileName
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bmp.Dispose()
  Write-Host "Wrote $path (${width}x${height})"
}

# NSIS (dark theme — template controls text color)
New-NsisBitmap -Width 150 -Height 57 -FileName 'nsis-header.bmp'
New-NsisBitmap -Width 164 -Height 314 -FileName 'nsis-sidebar.bmp' -ShowTitle $true -LargeIcon $true

# WiX / MSI (light text panel — WixUI uses black text over the bitmap)
New-WixBannerBitmap -FileName 'wix-banner.bmp'
New-WixDialogBitmap -FileName 'wix-dialog.bmp'

Write-Host 'Installer bitmaps ready.'
