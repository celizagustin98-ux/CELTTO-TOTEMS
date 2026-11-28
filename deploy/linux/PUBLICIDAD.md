# Publicidad de la TV: direcciones y carpeta compartida

La publicidad (imágenes y videos MP4/WEBM) **no necesita guardarse en este servidor**. Hay tres formas:

| Forma | Qué se guarda acá | Cuándo usarla |
|---|---|---|
| **Por dirección (URL)** | Nada (solo la dirección) | El archivo ya está publicado en otro servidor web (`http://servidor/publicidad/aviso.mp4`). La TV lo descarga directo. |
| **Carpeta compartida** | Nada | Los archivos están en una carpeta compartida de otro servidor (Windows/Samba/NAS). Se reproduce todo lo que haya en la carpeta: para cambiar la publicidad, se copian o borran archivos ahí. |
| **Subir desde el panel** (opcional) | El archivo, en el volumen `celtto_media` | Instalaciones chicas sin otro servidor. Se habilita en *Configuración → Publicidad*. |

## Montar la carpeta compartida (Linux / Proxmox)

1. Instalá el cliente: `apt install cifs-utils`.
2. Guardá las credenciales en `/root/.publicidad.cred` (permisos 600):
   ```
   username=usuario_lectura
   password=…
   domain=MIDOMINIO
   ```
3. Agregá a `/etc/fstab` (solo lectura):
   ```
   //servidor-archivos/Publicidad  /mnt/publicidad  cifs  credentials=/root/.publicidad.cred,ro,iocharset=utf8,vers=3.0,_netdev,nofail  0 0
   ```
4. `mkdir -p /mnt/publicidad && mount -a`.
5. En el `.env`: `MEDIA_SHARE_HOST=/mnt/publicidad` y reiniciá: `docker compose up -d`.
   El contenedor la ve en `/mnt/publicidad` (solo lectura).
6. En *Configuración → Publicidad → Carpeta compartida*, activala y, si querés, elegí una subcarpeta (por ejemplo `TV-Sala`).

> Si la app corre directamente en Windows (sin Docker), poné en `MEDIA_SHARE_DIR` la ruta UNC (`\\servidor\Publicidad`)
> y ejecutá el servicio con un usuario que tenga permiso de lectura sobre esa carpeta.

**Formatos:** PNG, JPG, WEBP, GIF, MP4 (H.264 recomendado) y WEBM. Se reproducen en orden alfabético
(podés numerarlos: `01-bienvenida.mp4`, `02-vacunacion.jpg`). Los videos se reproducen completos y sin sonido.

**Seguridad:** la app solo lee archivos multimedia de esa carpeta (nunca escribe) y no permite salir de ella.
Usá un usuario de solo lectura para el montaje.

## Direcciones http en una app con https

Si el panel se usa con `https://` y la publicidad está en `http://`, algunos navegadores bloquean el contenido
"mixto". En ese caso publicá los archivos por https o usá la carpeta compartida.
