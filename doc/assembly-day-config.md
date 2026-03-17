# Configuracion sugerida para la asamblea del 18 de marzo de 2026

## Estado actual validado

- Produccion responde `healthy`.
- Con el ultimo deploy, la prueba `login + ballot` en produccion mejoro de forma importante.
- Validacion posterior al deploy:
  - `25` usuarios concurrentes: `100%` exito, `0%` errores.
  - `50` usuarios concurrentes: `100%` exito, `0%` errores.
  - `75` usuarios concurrentes: `100%` exito, `0%` errores.
  - `100` usuarios concurrentes: `100%` exito, `0%` errores.
  - `150` usuarios concurrentes: `100%` exito, `0%` errores.
  - `300` usuarios concurrentes: `98.66%` exito en login, `0.67%` de requests fallidos.

## Variables recomendadas en Railway para manana

Aplicar estas variables en el servicio `VR-API` y redeployar una sola vez:

```env
NODE_ENV=production
PUBLIC_URL=https://vr-api-production.up.railway.app
IS_PROXIED=true
CORS_ORIGIN=https://ccvr.up.railway.app

UP_RATE_LIMIT_ENABLED=false
UP_RATE_LIMIT_INTERVAL=60000
UP_RATE_LIMIT_MAX=120

UV_THREADPOOL_SIZE=32
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=30
VOTE_SUBMISSION_LOCK_TIMEOUT=15
```

## Motivo de cada ajuste

- `UP_RATE_LIMIT_ENABLED=false`
  - Evita que el login vuelva a bloquear residentes durante la ventana critica de ingreso.
- `UV_THREADPOOL_SIZE=32`
  - Ayuda con la carga de autenticacion concurrente, especialmente comparaciones de password.
- `DATABASE_POOL_MIN=5` y `DATABASE_POOL_MAX=30`
  - Da mas margen para atender consultas concurrentes de login y boleta.

## Recomendacion operativa

- Abrir el acceso `10` a `15` minutos antes del inicio formal.
- Pedir a los residentes ingresar antes de que empiece la votacion.
- Mantener esta configuracion durante toda la asamblea.

## Despues de la asamblea

Al terminar el evento, puedes volver a una configuracion mas conservadora:

```env
UP_RATE_LIMIT_ENABLED=true
UP_RATE_LIMIT_INTERVAL=60000
UP_RATE_LIMIT_MAX=30
```
