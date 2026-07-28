// ═══════════════════════════════════════════════════════════
//  Migración única: ventas.json / inventario.json / flujo.json
//  → Turso.  Ejecutar UNA VEZ, apuntando el .env a la base de
//  Turso real, antes de apagar el servidor viejo.
//
//  Uso:  node migrate.js
// ═══════════════════════════════════════════════════════════
const fs   = require('fs');
const path = require('path');
const db   = require('./db');

const PEDIDO_FIJOS = ['nota','cliente','telefono','servicio','fecha','hora','fechaEntrega','total','anticipo','estado','observaciones'];

const ETAPA_COLS = {
  marcoProveedorPedido:   'marco_proveedor_pedido',
  cristalProveedorPedido: 'cristal_proveedor_pedido',
  fotoSolicitada:         'foto_solicitada',
  mlSolicitada:           'ml_solicitada',
  materialRecibido:       'material_recibido',
  armado:                 'armado',
  listoEntrega:           'listo_entrega',
  marcoRechazado:         'marco_rechazado',
  cristalRechazado:       'cristal_rechazado',
};

function leerJSON(file, fallback) {
  const p = path.join(__dirname, file);
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) { return fallback; }
}

async function migrarPedidos() {
  const { pedidos = [] } = leerJSON('ventas.json', { pedidos: [] });
  let n = 0;
  for (const pedido of pedidos) {
    const fixed = {}, extra = {};
    Object.keys(pedido).forEach(k => { if (PEDIDO_FIJOS.includes(k)) fixed[k] = pedido[k]; else extra[k] = pedido[k]; });
    await db.execute({
      sql: `INSERT OR REPLACE INTO pedidos (nota, cliente, telefono, servicio, fecha, hora, fecha_entrega, total, anticipo, estado, observaciones, extra)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        String(fixed.nota), fixed.cliente || '', fixed.telefono || '', fixed.servicio || '',
        fixed.fecha || '', fixed.hora || '', fixed.fechaEntrega || '', fixed.total || 0,
        fixed.anticipo || 0, fixed.estado || 'Pendiente', fixed.observaciones || '',
        JSON.stringify(extra),
      ],
    });
    n++;
  }
  console.log(`✅ ${n} pedidos migrados`);
}

async function migrarInventario() {
  const inv = leerJSON('inventario.json', {});

  for (const p of inv.papel || []) {
    await db.execute({
      sql: `INSERT INTO inventario_papel (id, nombre, hojas, minimo, total_ingresado) VALUES (?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET nombre=excluded.nombre, hojas=excluded.hojas, minimo=excluded.minimo, total_ingresado=excluded.total_ingresado`,
      args: [p.id, p.nombre, p.hojas || 0, p.minimo || 0, p.totalIngresado || 0],
    });
  }

  for (const p of inv.portarretratos || []) {
    await db.execute({
      sql: `INSERT INTO inventario_portarretratos (id, tamano, precio, cantidad, total_ingresado, minimo) VALUES (?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET tamano=excluded.tamano, precio=excluded.precio, cantidad=excluded.cantidad, total_ingresado=excluded.total_ingresado, minimo=excluded.minimo`,
      args: [p.id, p.tamano, p.precio || 0, p.cantidad || 0, p.totalIngresado || 0, p.minimo || 2],
    });
  }

  for (const c of inv.cristales || []) {
    await db.execute({
      sql: `INSERT INTO inventario_cristales (id, tamano, tipo, cantidad, total_ingresado, minimo) VALUES (?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET tamano=excluded.tamano, tipo=excluded.tipo, cantidad=excluded.cantidad, total_ingresado=excluded.total_ingresado, minimo=excluded.minimo`,
      args: [c.id, c.tamano, c.tipo, c.cantidad || 0, c.totalIngresado || 0, c.minimo || 1],
    });
  }

  for (const m of inv.marcosStock || []) {
    await db.execute({
      sql: `INSERT INTO inventario_marcos_stock (id, tamano, modelo, color, precio, cantidad, total_ingresado, minimo) VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET tamano=excluded.tamano, modelo=excluded.modelo, color=excluded.color, precio=excluded.precio, cantidad=excluded.cantidad, total_ingresado=excluded.total_ingresado, minimo=excluded.minimo`,
      args: [m.id, m.tamano, m.modelo, m.color, m.precio || 0, m.cantidad || 0, m.totalIngresado || 0, m.minimo || 1],
    });
  }

  for (const m of inv.mdf || []) {
    await db.execute({
      sql: `INSERT INTO inventario_mdf (id, tamano, cantidad, total_ingresado, minimo) VALUES (?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET tamano=excluded.tamano, cantidad=excluded.cantidad, total_ingresado=excluded.total_ingresado, minimo=excluded.minimo`,
      args: [m.id, m.tamano, m.cantidad || 0, m.totalIngresado || 0, m.minimo || 1],
    });
  }

  for (const cat of ['carton','craft','autoadherible']) {
    if (inv[cat]) {
      await db.execute({
        sql: `INSERT INTO inventario_singleton (categoria, data) VALUES (?, ?) ON CONFLICT(categoria) DO UPDATE SET data = excluded.data`,
        args: [cat, JSON.stringify(inv[cat])],
      });
    }
  }

  for (const h of inv.historialIngresos || []) {
    await db.execute({
      sql: 'INSERT INTO historial_ingresos (tipo, fecha, hora, data) VALUES (?,?,?,?)',
      args: [h.tipo || '', h.fecha || '', h.hora || '', JSON.stringify(h)],
    });
  }

  console.log(`✅ Inventario migrado (papel:${(inv.papel||[]).length}, portarretratos:${(inv.portarretratos||[]).length}, cristales:${(inv.cristales||[]).length}, marcosStock:${(inv.marcosStock||[]).length}, mdf:${(inv.mdf||[]).length}, historial:${(inv.historialIngresos||[]).length})`);
}

async function migrarFlujo() {
  const { ordenes = [] } = leerJSON('flujo.json', { ordenes: [] });
  for (const o of ordenes) {
    const e = o.etapas || {};
    await db.execute({
      sql: `INSERT OR REPLACE INTO flujo_ordenes
            (nota, cliente, telefono, servicio, descripcion, cristal, ml, impresion, total, fecha_entrega, fecha_creacion, estado, notas,
             marco_proveedor_pedido, cristal_proveedor_pedido, foto_solicitada, ml_solicitada, material_recibido, armado, listo_entrega, marco_rechazado, cristal_rechazado)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        String(o.nota), o.cliente || '', o.telefono || '', o.servicio || '', o.descripcion || '',
        o.cristal || '—', o.ml ? 1 : 0, o.impresion ? 1 : 0, o.total || 0,
        o.fechaEntrega || '', o.fechaCreacion || '', o.estado || 'Pendiente', o.notas || '',
        e.marcoProveedorPedido ? 1:0, e.cristalProveedorPedido ? 1:0, e.fotoSolicitada ? 1:0,
        e.mlSolicitada ? 1:0, e.materialRecibido ? 1:0, e.armado ? 1:0, e.listoEntrega ? 1:0,
        e.marcoRechazado ? 1:0, e.cristalRechazado ? 1:0,
      ],
    });
  }
  console.log(`✅ ${ordenes.length} órdenes de flujo migradas`);
}

(async () => {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.executeMultiple(schema);
  console.log('🗄️  Esquema listo, iniciando migración…\n');

  await migrarPedidos();
  await migrarInventario();
  await migrarFlujo();

  console.log('\n🎉 Migración completa.');
  process.exit(0);
})().catch(e => {
  console.error('❌ Error en migración:', e);
  process.exit(1);
});
