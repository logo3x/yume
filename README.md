# Control de Negocio (HTML + JS + SQLite)

## Requisitos
- Node.js 18+

## Ejecutar
1. `npm install`
2. `npm start`
3. Abrir: `http://localhost:3000`

## Seguridad (nuevo)
- Al entrar por primera vez, el sistema pedirá crear el usuario administrador inicial.
- Luego se debe iniciar sesión para acceder a módulos y APIs.
- La sesión dura 24 horas.

## Backups (nuevo)
- Respaldo automático de la base cada 6 horas.
- Respaldo manual desde la pestaña **CAJA** con botón "Crear Respaldo Ahora".
- Se guardan en la carpeta `backups/`.
- El sistema conserva los 20 respaldos más recientes.

## Módulos
- Inventario
- Compras (proveedores)
- Ventas (descuenta stock y calcula ganancia)
- Envíos
- Caja (ingresos, egresos, dinero actual)
- Clientes
- Reportes y gráficas
- Configuración

## Base de datos
- Archivo SQLite: `negocio.db` (se crea automáticamente)
- Fotos de producto: `uploads/`
- Respaldos: `backups/`
