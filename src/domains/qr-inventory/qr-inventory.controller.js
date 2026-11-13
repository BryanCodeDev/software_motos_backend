const qrInventoryService = require('./qr-inventory.service');

const listPackages = async (req, res) => {
  const validated = req.validated;
  const result = await qrInventoryService.listPackages({
    design: validated.query.design,
    status: validated.query.status,
    batch: validated.query.batch,
    origin: validated.query.origin,
    from: validated.query.from,
    to: validated.query.to,
    page: validated.query.page,
    limit: validated.query.limit,
  });
  return res.json(result);
};

const getPackageDetail = async (req, res) => {
  const detail = await qrInventoryService.getPackageDetail(req.validated.params.id);
  if (!detail) {
    return res.status(404).json({ error: 'Paquete no encontrado', code: 'package_not_found' });
  }
  return res.json({ package: detail });
};

const createBatch = async (req, res) => {
  const { design_id, quantity, notes } = req.validated.body;
  const result = await qrInventoryService.createBatch({
    designId: design_id,
    quantity,
    createdBy: req.user.id,
    notes,
    ipAddress: req.ip,
  });
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error, code: result.error });
  }
  return res.status(201).json({ batch: result.batch });
};

const markBatchPrinted = async (req, res) => {
  const result = await qrInventoryService.markBatchPrinted(req.validated.params.id, req.user.id, req.ip);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error, code: result.error });
  }
  return res.json({ batch: result });
};

const markBatchReceived = async (req, res) => {
  const { quantity_confirmed } = req.validated.body;
  const result = await qrInventoryService.markBatchReceived(
    req.validated.params.id,
    quantity_confirmed,
    req.user.id,
    req.ip
  );
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error, code: result.error });
  }
  return res.json({ batch: result });
};

const markBatchCancelled = async (req, res) => {
  const result = await qrInventoryService.markBatchCancelled(req.validated.params.id, req.user.id, req.ip);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error, code: result.error });
  }
  return res.json({ batch: result });
};

const setPackageStatus = async (req, res) => {
  const { status } = req.validated.body;
  const result = await qrInventoryService.setPackageStatus(req.validated.params.id, status, req.user.id, req.ip);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error, code: result.error });
  }
  return res.json({ package: result });
};

const getDashboardStats = async (req, res) => {
  const stats = await qrInventoryService.getDashboardStats();
  return res.json({ stats });
};

const releaseExpiredReservations = async (req, res) => {
  const count = await qrInventoryService.releaseExpiredReservations();
  return res.json({ released: count });
};

const exportPackages = async (req, res) => {
  const { format = 'csv', ...filters } = req.validated.query;
  const rows = await qrInventoryService.listPackagesForExport(filters);
  if (format === 'zip') {
    const archiver = require('archiver');
    const QRCode = require('qrcode');
    const archive = archiver('zip', { zlib: { level: 6 } });
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', 'attachment; filename="qr-inventario.zip"');
    res.set('Cache-Control', 'private, no-store');
    archive.pipe(res);
    archive.on('error', (err) => {
      if (!res.headersSent) return res.status(500).json({ error: 'Error generando el ZIP', code: 'zip_error' });
      res.end();
    });
    for (const row of rows) {
      try {
        const png = await QRCode.toBuffer(row.value, {
          type: 'buffer', width: 1200, margin: 4,
          color: { dark: '#0b1016', light: '#ffffff' },
        });
        archive.append(png, { name: `QR_${row.value}.png` });
      } catch {}
    }
    const buildCsvRow = (r) => {
      const esc = (v) => {
        const s = String(v === null || v === undefined ? '' : v);
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      return [
        esc(r.id), esc(r.package_code), esc(r.value), esc(r.public_url),
        esc(r.design_name), esc(r.design_slug), esc(r.batch_code),
        esc(r.order_number), esc(r.status), esc(r.origin), esc(r.quantity_stickers),
      ].join(',');
    };
    const header = ['id_paquete','codigo_paquete','identificador_qr','url_publica','diseno_nombre','diseno_slug','lote','pedido_referencia','estado','origen','cantidad_stickers'];
    archive.append([header.join(','), ...rows.map(buildCsvRow)].join('\n') + '\n', { name: 'identificacion_paquetes.csv' });
    await archive.finalize();
    return;
  }
  // CSV
  const esc = (v) => {
    const s = String(v === null || v === undefined ? '' : v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = ['id_paquete','codigo_paquete','identificador_qr','url_publica','diseno_nombre','diseno_slug','lote','pedido_referencia','estado','origen','cantidad_stickers'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      esc(r.id), esc(r.package_code), esc(r.value), esc(r.public_url),
      esc(r.design_name), esc(r.design_slug), esc(r.batch_code),
      esc(r.order_number), esc(r.status), esc(r.origin), esc(r.quantity_stickers),
    ].join(','));
  }
  const csv = lines.join('\n') + '\n';
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="qr-inventario.csv"');
  res.set('Cache-Control', 'private, no-store');
  return res.send(csv);
};

module.exports = {
  listPackages,
  getPackageDetail,
  createBatch,
  markBatchPrinted,
  markBatchReceived,
  markBatchCancelled,
  setPackageStatus,
  getDashboardStats,
  releaseExpiredReservations,
  exportPackages,
};
