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
| `BRIDGE_HOST` | IP del bridge. Por defecto `192.168.88.37` |
| `HLS_PORT` | Puerto del master HLS, por defecto `8888` |
| `HLS_PATH` | Plantilla, por defecto `/hls/{camera}.m3u8` |
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

La pestaña En vivo no hace proxy. `hls.js` abre el master tal cual, por ejemplo `http://192.168.88.37:8888/hls/estacionamiento.m3u8`, y resuelve los segmentos contra ese host. El puerto 5080 es solo el WebUI.

No hay autenticación: es para la red de casa. No publiques el puerto 3000 en internet.
