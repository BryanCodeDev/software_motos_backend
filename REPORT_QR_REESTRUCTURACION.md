# Informe de compatibilidad y resumen técnico — Reestructuración QR

## 1. Compatibilidad con los QR existentes (protegida)

Se inspeccionó `identifiers` antes de cualquier cambio. Ningún registro existente fue eliminado ni reasignado:

- QR activos: conservan `value` y `public_url` (`/e/:identifier` sin cambios).
- QR impresos/entregados (`print_status = printed/delivered`): conservados obligatoriamente; nunca se les cambia el identificador.
- QR pendientes de activación y sin imprimir: pueden ser retirados con estado explícito `retired` y su auditoría se conserva (`audit_logs` intacta).
- Usuarios existentes sin QR: siguen funcionando; el panel y la ruta pública no fallan por ausencia de identificador.
- Migración masiva: NO se ejecutó. Cada registro se clasifica individualmente; los históricos y sus auditorías se mantienen.

Regla crítica respetada: el identificador y la URL de un QR ya asignado nunca cambian después de la asignación.

## 2. Cambios de base de datos (migraciones, sin borrar datos)

`backend/migrations/schema.sql` + `backend/src/config/db.js` (`ensureInventorySchema`, ejecutado al arrancar `server.js`):

- `qr_inventory_batches`: lotes de producción (código, diseño, cantidades solicitada/confirmada, estado, creador, fechas).
- `qr_inventory_packages`: paquetes físicos reales (id, código, lote, diseño, identificador, `value`, `public_url`, estado físico, usuario, pedido, origen `inventory`/`on_demand`, 2 stickers, fechas de impresión/despacho/entrega, `reserved_until`).
- `orders`: columnas `inventory_origin` (`inventory`/`on_demand`) y `package_id` (FK a `qr_inventory_packages`).
- `identifiers`: columna `package_id` (FK a `qr_inventory_packages`).

Índices y restricciones de unicidad sobre `value` y `package_code` para evitar duplicados. Todas las columnas/tabla usan `CREATE ... IF NOT EXISTS` y `ALTER ... ADD COLUMN` con tolerancia a duplicados, por lo que es seguro reejecutar sobre bases existentes.

## 3. Registro sin QR (cambio fundamental)

`auth.register` ya NO llama a `ensureOrCreatePendingQr`. Crea cuenta, perfil de emergencia (`is_active = 0`) y no genera identificador ni consume inventario. La respuesta no incluye `qr`. La cuenta funciona sin identificador; el QR se asigna/genera solo al comprar stickers.

## 4. Flujo de compra e inventario (backend)

- `order.create`: reserva un paquete disponible del diseño elegido (`FOR UPDATE SKIP LOCKED`, bloqueo de fila, TTL de reserva configurable `QR_RESERVATION_TTL_MINUTES`). Si no hay stock, `inventory_origin = 'on_demand'` (producción bajo pedido).
- Bloqueo: un usuario con QR activo/impreso/entregado no puede comprar otro sticker mediante compra ordinaria (`user_already_has_qr`).
- Webhook de pago aprobado: `assignOrCreateForOrder` — asigna el paquete reservado (crea `identifiers` activo + URL) o genera un paquete `in_production` bajo pedido. Idempotente ante webhooks repetidos (no duplica identificador).
- Pedido cancelado/pago fallido: se libera el paquete solo si es seguro (no impreso/despachado).
- Reservas vencidas se liberan automáticamente (`releaseExpiredReservations`).

## 5. Estados del inventario físico (separados de la activación del QR)

`available`, `reserved`, `assigned`, `in_production`, `printed`, `dispatched`, `delivered`, `cancelled`, `retired`. Los estados de impresión NO activan ni desactivan el QR; la activación depende de la confirmación del pago (Mercado Pago o administrativo).

## 6. Módulo administrativo: Inventario de stickers y códigos QR

`backend/src/domains/qr-inventory/` con rutas bajo `/api/admin/qr-inventory` (solo admin):

- `GET /stats` — resumen por estado/origen y contadores de identificadores activos/pendientes.
- `GET /packages` — listado paginado con filtros por diseño, estado, lote, fecha.
- `GET /packages/:id` — detalle con imagen del diseño, QR, identificador, URL, estados, usuario, pedido, fechas, historial de auditoría.
- `POST /packages/:id/status` — cambiar estado físico (impreso/despachado/entregado/…).
- `POST /batches` — generar lote por diseño (códigos, URLs, PNG, ZIP/CSV/PDF descargables).
- `POST /batches/:id/print | /receive | /cancel` — ciclo de vida del lote.
- `GET /export` — exportación para proveedor (CSV/ZIP) sin datos personales.

## 7. Exportaciones para el proveedor

CSV con: id_paquete, código_paquete, identificador_qr, url_publica, diseno_nombre, diseno_slug, lote, pedido_referencia, estado, origen, cantidad_stickers. Sin nombre, correo, teléfono ni datos médicos. Cada QR individual y relacionado a su diseño y paquete. ZIP incluye PNG por identificador + CSV.

## 8. Ruta pública `GET /api/e/:identifier` (y `/e/:identifier`)

- Inexistente: 404.
- Sin propietario (paquete de inventario sin usuario): 410 controlado, sin datos personales.
- Asignado pero sin pagar: estado no activado.
- Asignado y activo: solo el perfil público autorizado.
- Deshabilitado/retirado: respuesta controlada.

## 9. Seguridad y privacidad

- Todas las rutas de inventario requieren autenticación + rol `admin`.
- Los QR sin propietario no revelan datos personales; las imágenes QR no incluyen información personal.
- Identificadores aleatorios y únicos; restricciones de unicidad en BD.
- Asignaciones auditadas en `audit_logs`.
- Los proveedores reciben únicamente los archivos necesarios para producción.

## 10. Pruebas (52 pruebas, 0 fallos)

Backend (`npm test`, ejecutado en paralelo con DB y puerto aislados por archivo):

- Registro sin QR / sin compra (no crea `identifiers`).
- Compra con stock físico disponible (reserva paquete).
- Compra sin stock (producción bajo pedido).
- Seis diseños del catálogo; dos stickers con mismo QR por paquete; paquetes con identificadores distintos.
- Dos compras simultáneas del último paquete: solo una reserva.
- Pago aprobado → identificador activo asignado; idempotente ante reintentos.
- Pago rechazado; webhook repetido sin duplicar.
- Reserva vencida se libera.
- Cancelación de pedido.
- Producción bajo pedido vinculada al usuario.
- Activación del QR; estados de impresión no afectan activación.
- Escaneo de QR sin propietario (410 controlado) y QR activo (perfil público).
- Conservación de QR históricos.
- Exportación de lotes (CSV sin datos personales).
- Compatibilidad con pedidos existentes y usuarios sin QR en el panel de administración.

## 11. Archivos modificados (backend)

- `backend/migrations/schema.sql` — tablas `qr_inventory_batches`, `qr_inventory_packages`; columnas `orders.inventory_origin`, `orders.package_id`, `identifiers.package_id`; índices y FK.
- `backend/src/config/db.js` — `ensureInventorySchema()` (sincroniza tablas/columnas en bases existentes).
- `backend/src/server.js` — ejecuta `ensureInventorySchema()` al arrancar.
- `backend/src/routes/index.js` — ruta pública `GET /api/e/:identifier` y rutas admin de inventario.
- `backend/src/domains/auth/auth.service.js` — registro ya no genera QR ni consume inventario.
- `backend/src/domains/orders/order.service.js` — reserva de inventario / on-demand / bloqueo de usuario con QR.
- `backend/src/domains/payments/payment.service.js` — webhook aprobado asigna/genera QR para pedidos de sticker.
- `backend/src/domains/admin/admin.service.js` — `activateQr` solo para pedidos no-sticker (stickers usan flujo de compra/inventario).
- `backend/src/domains/emergency-profiles/profile.service.js` — `/e/:identifier` responde controlado para identificadores sin propietario.
- `backend/src/domains/qr-inventory/` (nuevo): `qr-inventory.service.js`, `qr-inventory.controller.js`, `qr-inventory.routes.js`, `qr-inventory.schema.js`, `index.js`.
- `backend/test-harness.js` — DATABASE_URL explícita y puerto configurable por prueba.
- `backend/test-utils.js` — `resetDb()` usa `process.env.DB_NAME` (DB aislada por archivo de prueba).
- `backend/test/identifier-qr.test.js` — pruebas actualizadas al nuevo registro sin QR.
- `backend/test/qr-inventory.test.js` (nuevo) — 11 pruebas del módulo de inventario.
- `backend/src/domains/identifiers/identifier.service.js` — exporta `ensureProfileTx`.
- `frontend/src/pages/auth/Register.jsx` — paso 3 ahora es "Compra tus stickers" (QR en la compra, no en el registro).
- `frontend/src/pages/Checkout.jsx` — aviso de "Disponible" vs "Producción bajo pedido" según `order.production_required`.

## 12. Decisiones técnicas clave

- No se creó una segunda infraestructura QR: se reutilizan `identifiers`, `value`, `public_url`, `/e/:identifier`, `audit_logs` y `activateQr`.
- Un paquete físico = exactamente 2 stickers con el mismo QR; cada paquete tiene identificador distinto (único en BD).
- El registro no consume inventario ni genera QR; la compra determina la asignación.
- Activación del QR depende del pago aprobado, no de la impresión.
- Reservas con `FOR UPDATE SKIP LOCKED`, TTL, liberación automática de vencidas y protección contra pedidos duplicados/webhooks repetidos.
- Migraciones aditivas (`IF NOT EXISTS` / `ADD COLUMN` tolerantes), sin `DROP` de datos existentes.
