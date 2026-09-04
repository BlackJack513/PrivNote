Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(64, 64)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 200, 30, 30))
if ($null -eq $brush) { Write-Host 'BRUSH IS NULL' } else { Write-Host 'brush ok' }
$g.FillRectangle($brush, 0, 0, 64, 64)
$g.Dispose()
$bmp.Save((Join-Path (Get-Location) 'probe.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host 'PROBE FILE DONE'
