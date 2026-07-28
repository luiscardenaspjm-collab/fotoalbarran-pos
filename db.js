// ═══════════════════════════════════════════════════════════
//  Cliente único de Turso para toda la app (patrón singleton,
//  igual que en Shoes Cleaning: backend/src/config/db.js)
// ═══════════════════════════════════════════════════════════
const { createClient } = require('@libsql/client');
require('dotenv').config();

if (!process.env.TURSO_DATABASE_URL) {
  console.error('❌ Falta TURSO_DATABASE_URL en el .env');
  process.exit(1);
}

// TURSO_AUTH_TOKEN no es necesario cuando se usa una DB local
// (file:...) para pruebas, pero sí es obligatorio contra Turso real.
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

module.exports = db;
