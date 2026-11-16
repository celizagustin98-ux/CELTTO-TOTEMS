# Instala CELTTO-TOTEMS como servicio de Windows usando NSSM (https://nssm.cc).
# Ejecutar como Administrador, desde la carpeta del proyecto, DESPUÉS de "npm run build".
param([string]$Name = 'CELTTO-TOTEMS', [string]$Nssm = 'nssm', [int]$Port = 8080)

$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$node = (Get-Command node).Source
New-Item -ItemType Directory -Force "$root\logs" | Out-Null

& $Nssm install $Name $node "dist\server\index.js"
& $Nssm set $Name AppDirectory $root
& $Nssm set $Name Start SERVICE_AUTO_START
& $Nssm set $Name AppStdout "$root\logs\salida.log"
& $Nssm set $Name AppStderr "$root\logs\errores.log"
& $Nssm set $Name AppRotateFiles 1
& $Nssm set $Name AppRotateBytes 5242880

New-NetFirewallRule -DisplayName $Name -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
Start-Service $Name
Write-Host "Servicio '$Name' instalado e iniciado en el puerto $Port."
