// ═══════════════════════════════════════════════════════════
//  FOTO ALBARRÁN — Servidor POS v3 (Turso + Railway)
//  Uso local:  node server.js  → http://localhost:3000/pos.html
//  En Railway: usa la URL pública que asigna Railway (mismo puerto
//              vía process.env.PORT). Mismo servicio sirve la API
//              y los archivos pos.html / dashboard.html.
// ═══════════════════════════════════════════════════════════

const http = require('http');
const fs   = require('fs');
const path = require('path');
const db   = require('./db');

const PORT = process.env.PORT || 3000;

// ── Mapeo de "etapas" del flujo (camelCase ↔ columna SQL) ────
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

// Campos "fijos" de un pedido — todo lo demás va a la columna `extra` (JSON)
const PEDIDO_FIJOS = ['nota','cliente','telefono','servicio','fecha','hora','fechaEntrega','total','anticipo','estado','observaciones'];

function splitPedido(pedido) {
  const fixed = {}, extra = {};
  Object.keys(pedido).forEach(k => {
    if (PEDIDO_FIJOS.includes(k)) fixed[k] = pedido[k];
    else extra[k] = pedido[k];
  });
  return { fixed, extra };
}

function rowToPedido(row) {
  const extra = JSON.parse(row.extra || '{}');
  return {
    nota: row.nota, cliente: row.cliente, telefono: row.telefono,
    servicio: row.servicio, fecha: row.fecha, hora: row.hora,
    fechaEntrega: row.fecha_entrega, total: row.total, anticipo: row.anticipo,
    estado: row.estado, observaciones: row.observaciones,
    ...extra,
  };
}

function rowToOrden(row) {
  return {
    nota: row.nota, cliente: row.cliente, telefono: row.telefono,
    servicio: row.servicio, descripcion: row.descripcion, cristal: row.cristal,
    ml: !!row.ml, impresion: !!row.impresion, total: row.total,
    fechaEntrega: row.fecha_entrega, fechaCreacion: row.fecha_creacion,
    notas: row.notas, estado: row.estado,
    etapas: {
      marcoProveedorPedido:   !!row.marco_proveedor_pedido,
      cristalProveedorPedido: !!row.cristal_proveedor_pedido,
      fotoSolicitada:         !!row.foto_solicitada,
      mlSolicitada:           !!row.ml_solicitada,
      materialRecibido:       !!row.material_recibido,
      armado:                 !!row.armado,
      listoEntrega:           !!row.listo_entrega,
      marcoRechazado:         !!row.marco_rechazado,
      cristalRechazado:       !!row.cristal_rechazado,
    },
  };
}

// ── Inicializar esquema (idempotente) ────────────────────────
async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.executeMultiple(sql);
  console.log('🗄️  Esquema Turso listo');
}

// ── Lectura completa del inventario (misma forma que antes) ──
async function getInventarioFull() {
  const [papelR, portaR, cristR, msR, mdfR, singR] = await Promise.all([
    db.execute('SELECT * FROM inventario_papel'),
    db.execute('SELECT * FROM inventario_portarretratos'),
    db.execute('SELECT * FROM inventario_cristales'),
    db.execute('SELECT * FROM inventario_marcos_stock'),
    db.execute('SELECT * FROM inventario_mdf'),
    db.execute('SELECT * FROM inventario_singleton'),
  ]);
  const single = {};
  singR.rows.forEach(r => { single[r.categoria] = JSON.parse(r.data); });
  const histR = await db.execute('SELECT data FROM historial_ingresos ORDER BY id ASC');

  return {
    papel: papelR.rows.map(r => ({ id: r.id, nombre: r.nombre, hojas: r.hojas, minimo: r.minimo, totalIngresado: r.total_ingresado })),
    portarretratos: portaR.rows.map(r => ({ id: r.id, tamano: r.tamano, precio: r.precio, cantidad: r.cantidad, totalIngresado: r.total_ingresado, minimo: r.minimo })),
    cristales: cristR.rows.map(r => ({ id: r.id, tamano: r.tamano, tipo: r.tipo, cantidad: r.cantidad, totalIngresado: r.total_ingresado, minimo: r.minimo })),
    marcosStock: msR.rows.map(r => ({ id: r.id, tamano: r.tamano, modelo: r.modelo, color: r.color, precio: r.precio, cantidad: r.cantidad, totalIngresado: r.total_ingresado, minimo: r.minimo })),
    mdf: mdfR.rows.map(r => ({ id: r.id, tamano: r.tamano, cantidad: r.cantidad, totalIngresado: r.total_ingresado, minimo: r.minimo })),
    carton: single.carton || {},
    craft: single.craft || {},
    autoadherible: single.autoadherible || {},
    historialIngresos: histR.rows.map(r => JSON.parse(r.data)),
  };
}

// Returns array of low-stock warnings (≤15% of total ingresado) — igual que antes
function checkStockAlerts(inv) {
  const alerts = [];
  (inv.papel||[]).forEach(p => {
    if ((p.totalIngresado||0) > 0 && (p.hojas||0) <= (p.totalIngresado * 0.15))
      alerts.push({ tipo: 'papel', nombre: p.nombre, restante: p.hojas, total: p.totalIngresado });
  });
  (inv.portarretratos||[]).forEach(p => {
    if ((p.totalIngresado||0) > 0 && (p.cantidad||0) <= (p.totalIngresado * 0.15))
      alerts.push({ tipo: 'portarretrato', nombre: p.tamano, restante: p.cantidad, total: p.totalIngresado });
  });
  (inv.marcosStock||[]).forEach(m => {
    if ((m.totalIngresado||0) > 0 && (m.cantidad||0) <= (m.totalIngresado * 0.15))
      alerts.push({ tipo: 'marcoStock', nombre: m.tamano+' '+m.modelo, restante: m.cantidad, total: m.totalIngresado });
  });
  (inv.cristales||[]).forEach(c => {
    if ((c.totalIngresado||0) > 0 && (c.cantidad||0) <= (c.totalIngresado * 0.15))
      alerts.push({ tipo: 'cristal', nombre: c.tamano+' '+c.tipo, restante: c.cantidad, total: c.totalIngresado });
  });
  (inv.mdf||[]).forEach(m => {
    if ((m.totalIngresado||0) > 0 && (m.cantidad||0) <= (m.totalIngresado * 0.15))
      alerts.push({ tipo: 'mdf', nombre: 'MDF '+m.tamano, restante: m.cantidad, total: m.totalIngresado });
  });
  const aa = inv.autoadherible||{};
  if ((aa.totalIngresado||0) > 0 && (aa.piezas||0) <= (aa.totalIngresado * 0.15))
    alerts.push({ tipo: 'autoadherible', nombre: 'Papel Autoadherible', restante: aa.piezas, total: aa.totalIngresado });
  const ct = inv.carton||{};
  if ((ct.totalCm2||0) > 0 && (ct.cm2||0) <= (ct.totalCm2 * 0.15))
    alerts.push({ tipo: 'carton', nombre: 'Cartón', restante: Math.round(ct.cm2||0), total: Math.round(ct.totalCm2||0) });
  const cr = inv.craft||{};
  if ((cr.totalCm2||0) > 0 && (cr.cm2||0) <= (cr.totalCm2 * 0.15))
    alerts.push({ tipo: 'craft', nombre: 'Papel Craft', restante: Math.round(cr.cm2||0), total: Math.round(cr.totalCm2||0) });
  return alerts;
}

// ── Utilidades HTTP ───────────────────────────────────────────
function json(res, obj, status = 200) {
  res.writeHead(status, {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type',
  });
  res.end(JSON.stringify(obj));
}

function serveFile(res, filePath) {
  const ext  = path.extname(filePath).toLowerCase();
  const mime = {
    '.html':'text/html', '.js':'application/javascript',
    '.css':'text/css', '.png':'image/png',
    '.jpg':'image/jpeg', '.ico':'image/x-icon'
  };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('404 - No encontrado'); return; }
    const headers = { 'Content-Type': mime[ext] || 'text/plain' };
    if (ext === '.html') {
      headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      headers['Pragma'] = 'no-cache';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch(e) { reject(e); }
    });
  });
}

// ════════════════════════════════════════════════════════════
//  SERVIDOR
// ════════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  try {

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':'*',
      'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type'
    });
    res.end(); return;
  }

  const url = req.url.split('?')[0];

  // ══════════════════════════════════════
  //  VENTAS
  // ══════════════════════════════════════

  if (req.method === 'GET' && url === '/ventas') {
    const r = await db.execute('SELECT * FROM pedidos ORDER BY rowid ASC');
    return json(res, { pedidos: r.rows.map(rowToPedido) });
  }

  if (req.method === 'GET' && url === '/nextNota') {
    const r = await db.execute('SELECT nota FROM pedidos');
    const notas = r.rows.map(row => parseInt(row.nota)).filter(n => !isNaN(n));
    const next  = notas.length > 0 ? Math.max(...notas) + 1 : 1001;
    return json(res, { nextNota: next });
  }

  if (req.method === 'POST' && url === '/guardar') {
    try {
      const pedido = await readBody(req);
      const now = new Date();
      if (pedido.fechaPedido && pedido.fechaPedido.trim()) {
        const parts = pedido.fechaPedido.split('-');
        const custom = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
        pedido.fecha = custom.toLocaleDateString('es-MX');
        pedido.hora  = now.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' });
      } else {
        pedido.fecha = now.toLocaleDateString('es-MX');
        pedido.hora  = now.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' });
      }
      pedido.estado = pedido.estado || 'Pendiente';

      const { fixed, extra } = splitPedido(pedido);
      await db.execute({
        sql: `INSERT INTO pedidos (nota, cliente, telefono, servicio, fecha, hora, fecha_entrega, total, anticipo, estado, observaciones, extra)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          String(fixed.nota), fixed.cliente, fixed.telefono || '', fixed.servicio,
          fixed.fecha, fixed.hora, fixed.fechaEntrega || '', fixed.total || 0,
          fixed.anticipo || 0, fixed.estado, fixed.observaciones || '',
          JSON.stringify(extra),
        ],
      });

      // Si la venta lleva autoadherible → descontar 1 pieza
      if (pedido.autoadherible) {
        const r = await db.execute("SELECT data FROM inventario_singleton WHERE categoria='autoadherible'");
        const d = JSON.parse(r.rows[0].data);
        d.piezas = Math.max(0, (d.piezas||0) - 1);
        await db.execute({ sql: "UPDATE inventario_singleton SET data=? WHERE categoria='autoadherible'", args: [JSON.stringify(d)] });
        console.log(`🏷  Autoadherible: -1 pieza → quedan ${d.piezas}`);
      }

      // Si la venta usa papel fotográfico → descontar inventario
      if (pedido.papelUsado && pedido.hojasUsadas > 0) {
        await db.execute({ sql: 'UPDATE inventario_papel SET hojas = MAX(0, hojas - ?) WHERE id = ?', args: [pedido.hojasUsadas, pedido.papelUsado] });
        console.log(`📄 Papel ${pedido.papelUsado}: -${pedido.hojasUsadas} hojas`);
      }

      // Si es portarretrato de stock → descontar inventario
      if (pedido.esStock && pedido.stockTamano) {
        await db.execute({ sql: 'UPDATE inventario_portarretratos SET cantidad = MAX(0, cantidad - 1) WHERE tamano = ?', args: [pedido.stockTamano] });
        console.log(`🖼  Stock ${pedido.stockModelo} ${pedido.stockTamano}: -1`);
      }

      // Si el pedido tiene cristal → descontar del inventario de cristales
      if (pedido.cristalId) {
        await db.execute({ sql: 'UPDATE inventario_cristales SET cantidad = MAX(0, cantidad - 1) WHERE id = ?', args: [pedido.cristalId] });
        console.log(`🔲 Cristal descontado: ${pedido.cristalId}`);
      }

      // Descontar craft para Marcos Stock
      if (pedido.esMarcoStock && pedido.alto && pedido.ancho) {
        const area = parseFloat(pedido.alto) * parseFloat(pedido.ancho);
        const craftArea = area * 1.15;
        const r = await db.execute("SELECT data FROM inventario_singleton WHERE categoria='craft'");
        const d = JSON.parse(r.rows[0].data);
        d.cm2 = Math.max(0, (d.cm2||0) - craftArea);
        await db.execute({ sql: "UPDATE inventario_singleton SET data=? WHERE categoria='craft'", args: [JSON.stringify(d)] });
        console.log(`📦 Craft (Marco Stock): -${Math.round(craftArea)} cm²`);
      }

      // Si es marco de stock → descontar inventario
      if (pedido.esMarcoStock && pedido.msId) {
        await db.execute({ sql: 'UPDATE inventario_marcos_stock SET cantidad = MAX(0, cantidad - 1) WHERE id = ?', args: [pedido.msId] });
        console.log(`🖼  Marco Stock #${pedido.msId}: -1`);
      }

      // Descontar MDF o Cartón (+ craft) del inventario
      if (pedido.respaldo && pedido.alto && pedido.ancho) {
        const area = parseFloat(pedido.alto) * parseFloat(pedido.ancho);
        if (pedido.respaldo === 'MDF') {
          await db.execute({ sql: 'UPDATE inventario_mdf SET cantidad = MAX(0, cantidad - 1) WHERE tamano = ?', args: [pedido.respaldoId] });
        } else if (pedido.respaldo === 'Cartón') {
          const areaConMerma = area * 1.15;
          const r = await db.execute("SELECT data FROM inventario_singleton WHERE categoria='carton'");
          const d = JSON.parse(r.rows[0].data);
          d.cm2    = Math.max(0, (d.cm2||0) - areaConMerma);
          d.hojas  = Math.max(0, (d.hojas||0) - (areaConMerma/8700));
          await db.execute({ sql: "UPDATE inventario_singleton SET data=? WHERE categoria='carton'", args: [JSON.stringify(d)] });
          console.log(`📦 Cartón: -${Math.round(areaConMerma)} cm²`);
        }
        const craftArea = area * 1.15;
        const r2 = await db.execute("SELECT data FROM inventario_singleton WHERE categoria='craft'");
        const d2 = JSON.parse(r2.rows[0].data);
        d2.cm2 = Math.max(0, (d2.cm2||0) - craftArea);
        await db.execute({ sql: "UPDATE inventario_singleton SET data=? WHERE categoria='craft'", args: [JSON.stringify(d2)] });
        console.log(`📦 Craft: -${Math.round(craftArea)} cm²`);
      }

      // Crear orden en flujo de trabajo para Marcos personalizados / Flotados
      if ((pedido.servicio === 'Marcos' || pedido.servicio === 'Flotados') && !pedido.esStock) {
        await db.execute({
          sql: `INSERT INTO flujo_ordenes (nota, cliente, telefono, servicio, descripcion, cristal, ml, impresion, total, fecha_entrega, fecha_creacion, notas, estado)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [
            String(pedido.nota), pedido.cliente, pedido.telefono || '', pedido.servicio,
            `${pedido.alto}×${pedido.ancho} cm · ${pedido.moldura}`,
            pedido.cristal || '—', pedido.ml ? 1 : 0, pedido.impresion ? 1 : 0,
            pedido.total, pedido.fechaEntrega || '', pedido.fecha, '', 'En proceso',
          ],
        });
        console.log(`🔧 Orden de flujo creada: #${pedido.nota}`);
      }

      // Si usa sobrante, vincular con pedido origen
      if (pedido.sobrante && pedido.sobranteNota) {
        const r = await db.execute({ sql: 'SELECT extra FROM pedidos WHERE nota = ?', args: [String(pedido.sobranteNota)] });
        if (r.rows.length) {
          const ex = JSON.parse(r.rows[0].extra || '{}');
          ex.sobranteUsadoPor = ex.sobranteUsadoPor || [];
          if (!ex.sobranteUsadoPor.includes(String(pedido.nota))) ex.sobranteUsadoPor.push(String(pedido.nota));
          await db.execute({ sql: 'UPDATE pedidos SET extra = ? WHERE nota = ?', args: [JSON.stringify(ex), String(pedido.sobranteNota)] });
          console.log(`♻️  Sobrante nota #${pedido.sobranteNota} → usado en #${pedido.nota}`);
        }
      }

      console.log(`✅ Pedido #${pedido.nota} — ${pedido.cliente} — $${pedido.total}`);
      const stockAlerts = checkStockAlerts(await getInventarioFull());
      return json(res, { success: true, nota: pedido.nota, stockAlerts });
    } catch(e) {
      console.error('Error /guardar:', e.message);
      return json(res, { success: false, error: e.message }, 500);
    }
  }

  if (req.method === 'POST' && url === '/liquidar') {
    try {
      const { nota, nuevoAnticipo } = await readBody(req);
      const r = await db.execute({ sql: 'SELECT total FROM pedidos WHERE nota = ?', args: [String(nota)] });
      if (!r.rows.length) return json(res, { success: false, error: 'Pedido no encontrado' }, 404);
      const total = r.rows[0].total;
      const anticipoFinal = Math.min(nuevoAnticipo, total || nuevoAnticipo);
      if (nuevoAnticipo >= total) {
        await db.execute({ sql: "UPDATE pedidos SET anticipo = ?, estado = 'Listo' WHERE nota = ?", args: [anticipoFinal, String(nota)] });
      } else {
        await db.execute({ sql: 'UPDATE pedidos SET anticipo = ? WHERE nota = ?', args: [anticipoFinal, String(nota)] });
      }
      console.log(`💵 Pedido #${nota} — anticipo actualizado a $${nuevoAnticipo}`);
      return json(res, { success: true });
    } catch(e) {
      return json(res, { success: false, error: e.message }, 500);
    }
  }

  if (req.method === 'POST' && url === '/editarPedido') {
    try {
      const { nota, campos } = await readBody(req);
      const COLMAP = { cliente:'cliente', telefono:'telefono', fechaEntrega:'fecha_entrega', fecha:'fecha', observaciones:'observaciones', anticipo:'anticipo', estado:'estado' };
      const sets = [], args = [];
      Object.keys(campos||{}).forEach(k => {
        if (COLMAP[k] && campos[k] !== undefined) { sets.push(`${COLMAP[k]} = ?`); args.push(campos[k]); }
      });
      if (sets.length) {
        args.push(String(nota));
        await db.execute({ sql: `UPDATE pedidos SET ${sets.join(', ')} WHERE nota = ?`, args });
      }
      console.log(`✏️  Pedido #${nota} editado`);
      return json(res, { success: true });
    } catch(e) {
      return json(res, { success: false, error: e.message }, 500);
    }
  }

  if (req.method === 'POST' && url === '/eliminar') {
    try {
      const { nota } = await readBody(req);
      await db.execute({ sql: 'DELETE FROM pedidos WHERE nota = ?', args: [String(nota)] });
      console.log(`🗑  Pedido #${nota} eliminado`);
      return json(res, { success: true });
    } catch(e) {
      return json(res, { success: false, error: e.message }, 500);
    }
  }

  if (req.method === 'POST' && url === '/actualizarEstado') {
    try {
      const { nota, estado } = await readBody(req);
      await db.execute({ sql: 'UPDATE pedidos SET estado = ? WHERE nota = ?', args: [estado, String(nota)] });
      console.log(`🔄 Pedido #${nota} → ${estado}`);
      return json(res, { success: true });
    } catch(e) {
      return json(res, { success: false, error: e.message }, 500);
    }
  }

  if (req.method === 'GET' && url === '/analytics') {
    const r = await db.execute('SELECT * FROM pedidos');
    const pedidos = r.rows.map(rowToPedido);
    const moldCount = {}, colorCount = {}, servicios = {}, diasMap = {};

    pedidos.forEach(p => {
      if (p.moldura && p.moldura !== '—') {
        moldCount[p.moldura] = (moldCount[p.moldura] || 0) + 1;
        if (p.color && p.color !== '—') {
          const key = `${p.moldura} · ${p.color}`;
          colorCount[key] = (colorCount[key] || 0) + 1;
        }
      }
      const svc = p.servicio || 'Marcos';
      servicios[svc] = (servicios[svc] || 0) + (p.total || 0);
      if (p.fecha) diasMap[p.fecha] = (diasMap[p.fecha] || 0) + (p.total || 0);
    });

    return json(res, {
      topMolduras: Object.entries(moldCount).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([m,c])=>({moldura:m,cantidad:c})),
      topColores:  Object.entries(colorCount).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([c,n])=>({combo:c,cantidad:n})),
      servicios, diasMap
    });
  }

  // ══════════════════════════════════════
  //  INVENTARIO
  // ══════════════════════════════════════

  if (req.method === 'GET' && url === '/inventario') {
    return json(res, await getInventarioFull());
  }

  if (req.method === 'GET' && url === '/historialIngresos') {
    const r = await db.execute('SELECT data FROM historial_ingresos ORDER BY id DESC LIMIT 200');
    return json(res, { historial: r.rows.map(row => JSON.parse(row.data)) });
  }

  if (req.method === 'POST' && url === '/inventario/actualizarPrecioMS') {
    try {
      const { id, precio } = await readBody(req);
      await db.execute({ sql: 'UPDATE inventario_marcos_stock SET precio = ? WHERE id = ?', args: [precio, id] });
      console.log(`💰 Precio actualizado: Marco Stock #${id} → $${precio}`);
      return json(res, { success: true });
    } catch(e) {
      return json(res, { success: false, error: e.message }, 500);
    }
  }

  if (req.method === 'POST' && url === '/inventario/ingresar') {
    try {
      const ingreso = await readBody(req);
      const now = new Date();
      ingreso.fecha = now.toLocaleDateString('es-MX');
      ingreso.hora  = now.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' });

      if (ingreso.tipo === 'papel') {
        await db.execute({ sql: 'UPDATE inventario_papel SET hojas = hojas + ? WHERE id = ?', args: [ingreso.cantidad, ingreso.papelId] });
        console.log(`📦 Papel ${ingreso.papelId}: +${ingreso.cantidad} hojas`);

      } else if (ingreso.tipo === 'portarretrato') {
        const id = ingreso.tamano.replace(/[\s×xX]/g,'_');
        await db.execute({
          sql: `INSERT INTO inventario_portarretratos (id, tamano, precio, cantidad, total_ingresado, minimo)
                VALUES (?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                  cantidad = cantidad + excluded.cantidad,
                  total_ingresado = total_ingresado + excluded.cantidad,
                  precio = CASE WHEN excluded.precio > 0 THEN excluded.precio ELSE precio END`,
          args: [id, ingreso.tamano, ingreso.precio || 0, ingreso.cantidad, ingreso.cantidad, ingreso.minimo || 2],
        });
        console.log(`📦 Portarretrato ${ingreso.tamano}: +${ingreso.cantidad}`);

      } else if (ingreso.tipo === 'marcoStock') {
        const id = `${ingreso.tamano}_${ingreso.modelo}_${ingreso.color}`.replace(/\s/g,'_');
        await db.execute({
          sql: `INSERT INTO inventario_marcos_stock (id, tamano, modelo, color, precio, cantidad, total_ingresado, minimo)
                VALUES (?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                  cantidad = cantidad + excluded.cantidad,
                  precio = CASE WHEN excluded.precio > 0 THEN excluded.precio ELSE precio END`,
          args: [id, ingreso.tamano, ingreso.modelo, ingreso.color, ingreso.precio || 0, ingreso.cantidad, ingreso.cantidad, ingreso.minimo || 1],
        });
        console.log(`📦 Marco Stock ${ingreso.tamano} ${ingreso.modelo} ${ingreso.color}: +${ingreso.cantidad}`);

      } else if (ingreso.tipo === 'cristal') {
        const id = `${ingreso.tamano}_${ingreso.tipoCristal}`.replace(/\s/g,'_');
        await db.execute({
          sql: `INSERT INTO inventario_cristales (id, tamano, tipo, cantidad, total_ingresado, minimo)
                VALUES (?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                  cantidad = cantidad + excluded.cantidad,
                  total_ingresado = total_ingresado + excluded.cantidad`,
          args: [id, ingreso.tamano, ingreso.tipoCristal, ingreso.cantidad, ingreso.cantidad, ingreso.minimo || 1],
        });
        console.log(`📦 Cristal ${ingreso.tamano} ${ingreso.tipoCristal}: +${ingreso.cantidad}`);

      } else if (ingreso.tipo === 'mdf') {
        const id = ingreso.tamano.replace(/[\s×xX]/g,'_');
        await db.execute({
          sql: `INSERT INTO inventario_mdf (id, tamano, cantidad, total_ingresado, minimo)
                VALUES (?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                  cantidad = cantidad + excluded.cantidad,
                  total_ingresado = total_ingresado + excluded.cantidad`,
          args: [id, ingreso.tamano, ingreso.cantidad, ingreso.cantidad, ingreso.minimo || 1],
        });
        console.log(`📦 MDF ${ingreso.tamano}: +${ingreso.cantidad} piezas`);

      } else if (ingreso.tipo === 'carton') {
        const r = await db.execute("SELECT data FROM inventario_singleton WHERE categoria='carton'");
        const d = JSON.parse(r.rows[0].data);
        d.hojas    = (d.hojas || 0) + ingreso.hojas;
        d.cm2      = (d.cm2 || 0) + ingreso.hojas * 8700;
        d.totalCm2 = (d.totalCm2 || 0) + ingreso.hojas * 8700;
        if (ingreso.minimo !== undefined) d.minimo = ingreso.minimo;
        await db.execute({ sql: "UPDATE inventario_singleton SET data=? WHERE categoria='carton'", args: [JSON.stringify(d)] });
        console.log(`📦 Cartón: +${ingreso.hojas} hojas → total ${d.hojas}`);

      } else if (ingreso.tipo === 'craft') {
        const r = await db.execute("SELECT data FROM inventario_singleton WHERE categoria='craft'");
        const d = JSON.parse(r.rows[0].data);
        d.rollos   = (d.rollos || 0) + ingreso.rollos;
        d.cm2      = (d.cm2 || 0) + ingreso.cm2;
        d.totalCm2 = (d.totalCm2 || 0) + ingreso.cm2;
        if (ingreso.minimo !== undefined) d.minimo = ingreso.minimo;
        await db.execute({ sql: "UPDATE inventario_singleton SET data=? WHERE categoria='craft'", args: [JSON.stringify(d)] });
        console.log(`📦 Craft: +${ingreso.rollos} rollo(s) → ${d.cm2} cm²`);

      } else if (ingreso.tipo === 'autoadherible') {
        const r = await db.execute("SELECT data FROM inventario_singleton WHERE categoria='autoadherible'");
        const d = JSON.parse(r.rows[0].data);
        d.pliegos = (d.pliegos || 0) + ingreso.pliegos;
        d.piezas  = (d.piezas || 0) + ingreso.piezas;
        d.totalIngresado = (d.totalIngresado || 0) + ingreso.piezas;
        if (ingreso.minimo !== undefined) d.minimo = ingreso.minimo;
        await db.execute({ sql: "UPDATE inventario_singleton SET data=? WHERE categoria='autoadherible'", args: [JSON.stringify(d)] });
        console.log(`📦 Autoadherible: +${ingreso.pliegos} pliegos (+${ingreso.piezas} piezas)`);
      }

      await db.execute({
        sql: 'INSERT INTO historial_ingresos (tipo, fecha, hora, data) VALUES (?,?,?,?)',
        args: [ingreso.tipo, ingreso.fecha, ingreso.hora, JSON.stringify(ingreso)],
      });
      return json(res, { success: true });
    } catch(e) {
      console.error('Error /inventario/ingresar:', e.message);
      return json(res, { success: false, error: e.message }, 500);
    }
  }

  if (req.method === 'POST' && url === '/inventario/minimo') {
    try {
      const { tipo, id, minimo } = await readBody(req);
      const TABLE = { papel:'inventario_papel', portarretrato:'inventario_portarretratos', cristal:'inventario_cristales', marcoStock:'inventario_marcos_stock', mdf:'inventario_mdf' };
      const tabla = TABLE[tipo];
      if (tabla) await db.execute({ sql: `UPDATE ${tabla} SET minimo = ? WHERE id = ?`, args: [minimo, id] });
      return json(res, { success: true });
    } catch(e) {
      return json(res, { success: false, error: e.message }, 500);
    }
  }

  if (req.method === 'GET' && url === '/consumo') {
    const [pedidosR, inv] = await Promise.all([db.execute('SELECT * FROM pedidos'), getInventarioFull()]);
    const pedidos = pedidosR.rows.map(rowToPedido);

    const hojasConsumidas = {};
    inv.papel.forEach(p => { hojasConsumidas[p.id] = { nombre: p.nombre, hojas: 0, pulgadas2: 0 }; });

    const dims = {
      '4x6':  { w: 4,   h: 6   },
      '5x7':  { w: 5,   h: 7   },
      '6x8':  { w: 6,   h: 8   },
      '8x10': { w: 8,   h: 10  },
      '8x11': { w: 8.5, h: 11  }
    };

    pedidos.forEach(p => {
      if (p.papelUsado && p.hojasUsadas > 0) {
        const key = p.papelUsado;
        if (!hojasConsumidas[key]) hojasConsumidas[key] = { nombre: key, hojas: 0, pulgadas2: 0 };
        hojasConsumidas[key].hojas += p.hojasUsadas;
        const d = dims[key];
        if (d) hojasConsumidas[key].pulgadas2 += d.w * d.h * p.hojasUsadas;
      }
    });

    const stockActual = inv.papel.map(p => ({
      ...p,
      consumidas:  hojasConsumidas[p.id]?.hojas || 0,
      pulgadas2:   hojasConsumidas[p.id]?.pulgadas2 || 0,
      disponibles: Math.max(0, (p.hojas || 0) - (hojasConsumidas[p.id]?.hojas || 0)),
      alerta:      ((p.hojas || 0) - (hojasConsumidas[p.id]?.hojas || 0)) <= p.minimo
    }));

    const alertasPortarretratos = inv.portarretratos
      .filter(p => (p.cantidad || 0) <= (p.minimo || 2))
      .map(p => ({ ...p, alerta: true }));

    return json(res, {
      papel:                stockActual,
      portarretratos:       inv.portarretratos,
      cristales:            inv.cristales,
      alertasPortarretratos
    });
  }

  // ══════════════════════════════════════
  //  FLUJO DE TRABAJO
  // ══════════════════════════════════════

  if (req.method === 'GET' && url === '/flujo') {
    const r = await db.execute('SELECT * FROM flujo_ordenes ORDER BY rowid ASC');
    return json(res, { ordenes: r.rows.map(rowToOrden) });
  }

  if (req.method === 'POST' && url === '/flujo/actualizarEtapa') {
    try {
      const { nota, etapa, valor } = await readBody(req);
      const col = ETAPA_COLS[etapa];
      if (!col) return json(res, { success: false, error: 'Etapa inválida' }, 400);

      await db.execute({ sql: `UPDATE flujo_ordenes SET ${col} = ? WHERE nota = ?`, args: [valor ? 1 : 0, String(nota)] });
      if (valor === true) {
        if (etapa === 'marcoRechazado')   await db.execute({ sql: "UPDATE flujo_ordenes SET marco_proveedor_pedido = 0 WHERE nota = ?", args: [String(nota)] });
        if (etapa === 'cristalRechazado') await db.execute({ sql: "UPDATE flujo_ordenes SET cristal_proveedor_pedido = 0 WHERE nota = ?", args: [String(nota)] });
      }

      const r = await db.execute({ sql: 'SELECT * FROM flujo_ordenes WHERE nota = ?', args: [String(nota)] });
      if (r.rows.length) {
        const row = r.rows[0];
        let estado;
        if (row.listo_entrega)          estado = 'Listo para entregar';
        else if (row.armado)            estado = 'Armado';
        else if (row.material_recibido) estado = 'Material recibido';
        else {
          const completadas = [row.marco_proveedor_pedido, row.cristal_proveedor_pedido, row.foto_solicitada, row.ml_solicitada, row.material_recibido, row.armado, row.listo_entrega, row.marco_rechazado, row.cristal_rechazado].filter(Boolean).length;
          estado = completadas > 0 ? 'En proceso' : 'Pendiente';
        }
        await db.execute({ sql: 'UPDATE flujo_ordenes SET estado = ? WHERE nota = ?', args: [estado, String(nota)] });
      }
      console.log(`🔧 Flujo #${nota} · ${etapa} → ${valor}`);
      return json(res, { success: true });
    } catch(e) {
      return json(res, { success: false, error: e.message }, 500);
    }
  }

  if (req.method === 'POST' && url === '/flujo/nota') {
    try {
      const { nota, texto } = await readBody(req);
      await db.execute({ sql: 'UPDATE flujo_ordenes SET notas = ? WHERE nota = ?', args: [texto, String(nota)] });
      return json(res, { success: true });
    } catch(e) {
      return json(res, { success: false, error: e.message }, 500);
    }
  }

  if (req.method === 'POST' && url === '/flujo/eliminar') {
    try {
      const { nota } = await readBody(req);
      await db.execute({ sql: 'DELETE FROM flujo_ordenes WHERE nota = ?', args: [String(nota)] });
      console.log(`🗑  Orden de flujo #${nota} eliminada`);
      return json(res, { success: true });
    } catch(e) {
      return json(res, { success: false, error: e.message }, 500);
    }
  }

  // ── Archivos estáticos ───────────────────────────────────────
  const filePath = path.join(__dirname, url === '/' ? 'pos.html' : url);
  serveFile(res, filePath);

  } catch (e) {
    console.error('Error inesperado:', e);
    if (!res.headersSent) json(res, { success: false, error: 'Error interno' }, 500);
  }
});

initSchema().then(() => {
  server.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║   🖼  FOTO ALBARRÁN · POS (Turso)     ║');
    console.log('╠══════════════════════════════════════╣');
    console.log(`║   http://localhost:${PORT}/pos.html      ║`);
    console.log('╚══════════════════════════════════════╝');
    console.log('');
    console.log('  Base de datos: Turso (' + (process.env.TURSO_DATABASE_URL||'').slice(0,40) + '…)');
    console.log('  Ctrl + C para detener el servidor');
    console.log('');
  });
}).catch(e => {
  console.error('❌ No se pudo inicializar el esquema:', e);
  process.exit(1);
});
