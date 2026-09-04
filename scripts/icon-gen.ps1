Add-Type -AssemblyName System.Drawing

function Draw-RoundedRect {
    param($g, $brush, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r)
    $g.FillEllipse($brush, $x, $y, $r * 2, $r * 2) | Out-Null
    $g.FillEllipse($brush, ($x + $w - $r * 2), $y, $r * 2, $r * 2) | Out-Null
    $g.FillEllipse($brush, $x, ($y + $h - $r * 2), $r * 2, $r * 2) | Out-Null
    $g.FillEllipse($brush, ($x + $w - $r * 2), ($y + $h - $r * 2), $r * 2, $r * 2) | Out-Null
    $g.FillRectangle($brush, ($x + $r), $y, ($w - $r * 2), $h) | Out-Null
    $g.FillRectangle($brush, $x, ($y + $r), $w, ($h - $r * 2)) | Out-Null
}

function Draw-RoundedLeftCol {
    param($g, $brush, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r)
    $g.FillEllipse($brush, $x, $y, $r * 2, $r * 2) | Out-Null
    $g.FillEllipse($brush, $x, ($y + $h - $r * 2), $r * 2, $r * 2) | Out-Null
    $g.FillRectangle($brush, $x, ($y + $r), $w, ($h - $r * 2)) | Out-Null
    $g.FillRectangle($brush, ($x + $r), $y, ($w - $r), $h) | Out-Null
}

$S = 1024
$bmp = New-Object System.Drawing.Bitmap($S, $S)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# bg: indigo rounded square
$bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 79, 70, 229))
Draw-RoundedRect $g $bg 0 0 $S $S 236

# book body (white rounded rect)
$book = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
Draw-RoundedRect $g $book 272 268 480 500 58

# spine (light purple, rounded on left only)
$spine = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 203, 213, 255))
Draw-RoundedLeftCol $g $spine 272 268 118 500 58

# spine accent vertical line
$accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 99, 102, 241))
$g.FillRectangle($accent, 324, 316, 14, 404) | Out-Null

# page text lines
$line = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 148, 163, 184))
$line2 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 100, 116, 139))
$x0 = 430.0
$w0 = 268.0
$ys = @(356.0, 452.0, 548.0, 644.0)
foreach ($yy in $ys) {
    $g.FillRectangle($line, $x0, $yy, $w0, 30) | Out-Null
}
$g.FillRectangle($line, ($x0 + 78), 726.0, ($w0 - 78), 30) | Out-Null
$g.FillRectangle($line2, $x0, 316.0, $w0, 30) | Out-Null

$g.Dispose()
$out = Join-Path (Get-Location) 'app-icon.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "icon saved: $out"
