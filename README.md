# 🖼 Foto Albarrán — POS (Turso + Railway)

Sistema de punto de venta, inventario y flujo de trabajo de Foto Albarrán (León, Gto.). Antes corría 100% local (Node.js + archivos JSON); ahora la base de datos vive en **Turso** (en la nube) y el servidor se despliega en **Railway**, así que ya no depende de la IP local del PC del mostrador ni de que el router reasigne IPs cada vez que hay un corte de luz.

## 📁 Estructura

```
├── server.js       Servidor Node.js (API + sirve pos.html/dashboard.html)
├── db.js           Cliente único de Turso (patrón singleton)
├── schema.sql       Esquema de tablas (se aplica solo al arrancar)
├── migrate.js       Migración única de los JSON viejos → Turso
├── pos.html         Interfaz de mostrador
├── dashboard.html    Panel de inventario / historial / analytics
└── .env.example      Plantilla de variables de entorno
```

Todo corre en **un solo servicio** (a diferencia de proyectos con front/back separados): `server.js` sirve tanto la API como los archivos `pos.html` y `dashboard.html`, igual que hacía la versión local.

## 1️⃣ Requisitos

- Node.js 18+ → https://nodejs.org
- Cuenta Turso (gratis) → https://turso.tech
- Cuenta Railway → https://railway.app
- Cuenta GitHub

## 2️⃣ Base de datos (Turso)

```bash
# Instalar la CLI (macOS/Linux)
curl -sSfL https://get.tur.so/install.sh | bash
# Windows (PowerShell):
irm get.tur.so/install.ps1 | iex

turso auth login
turso db create foto-albarran

# Credenciales para el .env
turso db show foto-albarran --url
turso db tokens create foto-albarran
```

No hace falta correr `schema.sql` a mano — el servidor lo aplica solo al arrancar (`CREATE TABLE IF NOT EXISTS`, no borra nada si ya existe).

## 3️⃣ Migrar los datos actuales (una sola vez)

Con `ventas.json`, `inventario.json` y `flujo.json` todavía en esta carpeta:

```bash
npm install
cp .env.example .env     # edítalo con tu TURSO_DATABASE_URL y TURSO_AUTH_TOKEN
npm run migrate          # sube pedidos, inventario y flujo de trabajo a Turso
```

Verifica que los conteos impresos coincidan con lo que tenías (pedidos, cristales, marcos stock, etc.).

## 4️⃣ Probar local contra Turso

```bash
npm start   # → http://localhost:3000/pos.html
```

Si todo se ve igual que antes (ventas, inventario, flujo), ya puedes desplegar.

## 5️⃣ Subir a GitHub

```bash
git init
git add .
git commit -m "Foto Albarrán POS v3 — Turso + Railway"
git branch -M main
git remote add origin https://github.com/TUUSUARIO/foto-albarran-pos.git
git push -u origin main
```

`ventas.json`, `inventario.json`, `flujo.json`, `backups/` y `.env` están en `.gitignore` — no se suben (ya viven en Turso, y no queremos datos de clientes en un repo).

## 6️⃣ Desplegar en Railway

1. **New Project → Deploy from GitHub repo** → selecciona el repo.
2. En **Variables**, agrega:
   | Variable | Valor |
   |---|---|
   | `TURSO_DATABASE_URL` | La URL `libsql://…` de Turso |
   | `TURSO_AUTH_TOKEN` | El token de Turso |
3. Railway detecta `npm start` automáticamente (definido en `package.json`).
4. Railway asigna una URL pública tipo `https://foto-albarran-pos-production.up.railway.app` — esa es tu nueva dirección fija, ya no cambia nunca.

## 7️⃣ Usar la nueva URL

- **Mostrador (PC):** abre `https://TU-URL.up.railway.app/pos.html`
- **Dashboard (iPad u otro dispositivo):** `https://TU-URL.up.railway.app/dashboard.html`

Como `pos.html`/`dashboard.html` ahora usan rutas relativas (`SERVER=''`, `BASE=''`), no hay nada que reconfigurar nunca más al cambiar de red — funciona igual en la LAN de la tienda que desde cualquier lugar con internet.

## Notas

- El respaldo automático a `backups/` (cada 6 horas) se quitó: el sistema de archivos de Railway es efímero (se borra en cada redeploy), y ya no aporta nada — Turso guarda los datos de forma duradera por su cuenta.
- Si algún día quieres seguir corriendo una copia local además de Railway (por ejemplo como respaldo), basta con tener el mismo `.env` en esa PC — ambas instancias comparten la misma base de datos en Turso.
