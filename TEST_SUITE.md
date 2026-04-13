# QA Suite Blockchain - Cortex402

Este paquete agrega una suite automatizada para validar middleware + Stellar Testnet.

## Archivos

- test_suite.js: runner principal con 6 pruebas de integracion y etapa de preparacion.
- test_suite.sh: wrapper para ejecucion desde bash.
- test_config.env.example: plantilla de variables.
- test_report.json: salida generada en cada ejecucion.

## Preparacion

1. Copia test_config.env.example a test_config.env.
2. Completa URL_VPS, MASTER_SECRET y MERCHANT_WALLET.
3. Verifica conectividad a internet y acceso a Stellar Testnet.
4. Ejecuta desde una maquina local externa a la VPS.

## Ejecucion

Opcion A (bash):

bash test_suite.sh

Opcion B (node):

node test_suite.js

## Cobertura de pruebas

- Preparacion:
  - Verifica health de VPS por Cloudflare URL.
  - Verifica fondos USDC de cuenta maestra.
  - Opcionalmente dispara reset de estado por endpoint admin.
- Test 1 Trustline obligatoria:
  - Wallet nueva sin trustline.
  - Transferencia USDC inicial falla con OP_NO_TRUST.
  - Se crea trustline.
  - Transferencia USDC posterior exitosa.
- Test 2 Pago real end-to-end:
  - Solicita desafio 402 (compute o fallback intent).
  - Firma y envia pago 0.15 USDC con memo_hash.
  - Polling on-chain hasta 10s.
  - Reintenta compute con prueba de pago y exige HTTP 200.
  - Valida metrica de tiempo total menor a 25s.
- Test 3 Replay attack:
  - Repite la misma prueba de pago del Test 2.
  - Espera HTTP 400 y mensaje de replay/already redeemed.
- Test 4 Fondos insuficientes:
  - Drena USDC de wallet agente a wallet sink efimera.
  - Reintenta flujo de firma con maximo 3 intentos.
  - Debe capturar INSUFFICIENT_BALANCE y finalizar sin tx valida.
- Test 5 Timeout y resiliencia de red:
  - Si hay TUNNEL_INTERRUPT_CMD, intenta interrupcion real del tunnel.
  - Si no, usa simulacion unreachable.
  - Reintentos exponenciales maximo 3.
  - Valida fallo controlado con log VPS unreachable.
- Test 6 memo_hash expirado:
  - Solicita desafio de expiracion corta (2s).
  - Espera 3s y envia pago con memo hash.
  - Middleware debe rechazar (HTTP 400 o 402).

## Formato de reporte

test_report.json incluye:

- startedAt, target, horizon
- tests[] con:
  - id
  - name
  - status (passed/failed/skipped)
  - durationMs
  - details (status HTTP, tx hash enmascarado en logs, etc.)
- summary con conteos y duracion total

## Criterio de salida

- Exit code 0: ninguna prueba fallida.
- Exit code 1: una o mas pruebas fallidas.

## Seguridad

- Nunca se imprime la clave privada en texto plano.
- Las wallets de prueba se crean en memoria y no se persisten.
- Rate guard interno limita trafico para mantenerse por debajo de 100 req/min.

## Que hacer si falla

1. Revisa summary y details en test_report.json.
2. Si falla Preparacion, corrige conectividad/variables/fondos antes de repetir.
3. Si falla Test 1, revisa trustline USDC del destino.
4. Si falla Test 2 o 3, revisa contrato de /api/compute y validacion de replay.
5. Si falla Test 4, valida mapeo de error op_underfunded -> INSUFFICIENT_BALANCE.
6. Si falla Test 6, verifica soporte de expiracion corta en el middleware.

## QA manual adicional

- Ejecutar la suite desde equipo local con internet (no desde la VPS).
- Verificar transacciones en Stellar Expert (Testnet) usando tx hash del reporte.
- Confirmar que memo_hash no se conserva mas alla del TTL configurado.
