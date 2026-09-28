# Wyze DVR

Mini DVR local para ver las grabaciones que ya genera `docker-wyze-bridge` y, en una pestaña aparte, el directo HLS del mismo bridge. Esta app solo lee el disco. No modifica el contenedor ni su `docker-compose`.

## Estructura

```text
mywyzedash/
  server/           Express: cámaras, fechas, clips y mp4 con Range
  public/           Interfaz (grabaciones y en vivo, módulos separados)
  docker-compose.yml
  Dockerfile
```

## Stack

- Node.js 20+ y Express 4
- Frontend estático (HTML, CSS y módulos JS), sin build
- Calendario propio, al estilo Material Expressive de Veronica / Atlas Delta
- `hls.js` solo en la pestaña En vivo

## Configuración

Copia `.env.example` a `.env` si quieres correrlo con Docker Compose.

| Variable | Uso |
| --- | --- |
| `RECORDINGS_PATH` | Carpeta de grabaciones, solo lectura |
| `BRIDGE_HOST` | IP del Mac mini. Vacío: el navegador usa el mismo host que esta app |
| `HLS_PORT` | Puerto HLS de go2rtc, por defecto `8888` |
| `HLS_PATH` | Plantilla, por defecto `/{camera}/index.m3u8` |
| `RTSP_PORT` | Solo informativo. El navegador no abre RTSP |
| `PORT` | Puerto de esta app, por defecto `3000` |

## Arranque local

```bash
npm install
RECORDINGS_PATH=/Volumes/WyzeNVR/wyze-bridge/recordings npm start
```

Abre `http://<ip-del-mac>:3000`.

## Docker

El volumen se monta en solo lectura. Este compose es independiente del de wyze-bridge.

```bash
docker compose up -d --build
```

## API

- `GET /api/cameras`
- `GET /api/cameras/:camera/dates`
- `GET /api/cameras/:camera/clips?date=YYYY-MM-DD`
- `GET /api/media/:camera/:date/:archivo.mp4` (acepta `Range`)
- `GET /api/config` (host y puerto HLS para el navegador)

La pestaña En vivo pide el manifiesto directo al bridge, por ejemplo `http://<BRIDGE_HOST>:8888/oficina/index.m3u8`. Si esa ruta no coincide con tu go2rtc, ajústala con `HLS_PATH` mirando el enlace HLS en el WebUI del puerto 5080.

No hay autenticación: es para la red de casa. No publiques el puerto 3000 en internet.
