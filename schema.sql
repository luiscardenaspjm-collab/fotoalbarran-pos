-- ═══════════════════════════════════════════════════════════
--  FOTO ALBARRÁN — Esquema Turso (libSQL / SQLite)
--  Enfoque "mixto": columnas fijas para lo común a todos los
--  registros + una columna JSON ("extra"/"data") para los campos
--  que varían según el tipo de servicio o categoría.
-- ═══════════════════════════════════════════════════════════

-- PEDIDOS (antes ventas.json → pedidos[])
CREATE TABLE IF NOT EXISTS pedidos (
  nota            TEXT PRIMARY KEY,
  cliente         TEXT NOT NULL,
  telefono        TEXT DEFAULT '',
  servicio        TEXT NOT NULL,
  fecha           TEXT,
  hora            TEXT,
  fecha_entrega   TEXT DEFAULT '',
  total           REAL DEFAULT 0,
  anticipo        REAL DEFAULT 0,
  estado          TEXT DEFAULT 'Pendiente',
  observaciones   TEXT DEFAULT '',
  extra           TEXT NOT NULL DEFAULT '{}',
  creado_en       TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha  ON pedidos(fecha);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado);

-- INVENTARIO — PAPEL
CREATE TABLE IF NOT EXISTS inventario_papel (
  id              TEXT PRIMARY KEY,
  nombre          TEXT,
  hojas           INTEGER DEFAULT 0,
  minimo          INTEGER DEFAULT 0,
  total_ingresado INTEGER DEFAULT 0
);

-- INVENTARIO — PORTARRETRATOS
CREATE TABLE IF NOT EXISTS inventario_portarretratos (
  id              TEXT PRIMARY KEY,
  tamano          TEXT,
  precio          REAL DEFAULT 0,
  cantidad        INTEGER DEFAULT 0,
  total_ingresado INTEGER DEFAULT 0,
  minimo          INTEGER DEFAULT 2
);

-- INVENTARIO — CRISTALES
CREATE TABLE IF NOT EXISTS inventario_cristales (
  id              TEXT PRIMARY KEY,
  tamano          TEXT,
  tipo            TEXT,
  cantidad        INTEGER DEFAULT 0,
  total_ingresado INTEGER DEFAULT 0,
  minimo          INTEGER DEFAULT 1
);

-- INVENTARIO — MARCOS STOCK
CREATE TABLE IF NOT EXISTS inventario_marcos_stock (
  id              TEXT PRIMARY KEY,
  tamano          TEXT,
  modelo          TEXT,
  color           TEXT,
  precio          REAL DEFAULT 0,
  cantidad        INTEGER DEFAULT 0,
  total_ingresado INTEGER DEFAULT 0,
  minimo          INTEGER DEFAULT 1
);

-- INVENTARIO — MDF
CREATE TABLE IF NOT EXISTS inventario_mdf (
  id              TEXT PRIMARY KEY,
  tamano          TEXT,
  cantidad        INTEGER DEFAULT 0,
  total_ingresado INTEGER DEFAULT 0,
  minimo          INTEGER DEFAULT 1
);

-- INVENTARIO — categorías "singleton" (cartón, craft, autoadherible).
-- Cada una tiene campos distintos, así que se guardan como JSON.
CREATE TABLE IF NOT EXISTS inventario_singleton (
  categoria TEXT PRIMARY KEY,
  data      TEXT NOT NULL DEFAULT '{}'
);

-- HISTORIAL DE INGRESOS (log de entradas de stock)
CREATE TABLE IF NOT EXISTS historial_ingresos (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo  TEXT,
  fecha TEXT,
  hora  TEXT,
  data  TEXT NOT NULL DEFAULT '{}'
);

-- FLUJO DE TRABAJO (antes flujo.json → ordenes[]) — Marcos / Flotados
CREATE TABLE IF NOT EXISTS flujo_ordenes (
  nota                     TEXT PRIMARY KEY,
  cliente                  TEXT,
  telefono                 TEXT DEFAULT '',
  servicio                 TEXT,
  descripcion              TEXT,
  cristal                  TEXT DEFAULT '—',
  ml                       INTEGER DEFAULT 0,
  impresion                INTEGER DEFAULT 0,
  total                    REAL DEFAULT 0,
  fecha_entrega            TEXT DEFAULT '',
  fecha_creacion           TEXT,
  estado                   TEXT DEFAULT 'Pendiente',
  notas                    TEXT DEFAULT '',
  marco_proveedor_pedido   INTEGER DEFAULT 0,
  cristal_proveedor_pedido INTEGER DEFAULT 0,
  foto_solicitada          INTEGER DEFAULT 0,
  ml_solicitada            INTEGER DEFAULT 0,
  material_recibido        INTEGER DEFAULT 0,
  armado                   INTEGER DEFAULT 0,
  listo_entrega            INTEGER DEFAULT 0,
  marco_rechazado          INTEGER DEFAULT 0,
  cristal_rechazado        INTEGER DEFAULT 0
);

-- Semillas de las 3 categorías singleton (si no existen ya)
INSERT OR IGNORE INTO inventario_singleton (categoria, data) VALUES
  ('carton',        '{"hojas":0,"cm2":0,"minimo":2,"totalCm2":0}'),
  ('craft',         '{"rollos":0,"cm2":0,"minimo":1,"totalCm2":0}'),
  ('autoadherible', '{"pliegos":0,"piezas":0,"minimo":32,"totalIngresado":0}');
