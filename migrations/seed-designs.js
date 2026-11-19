#!/usr/bin/env node
/**
 * Seed de diseños de stickers para producción.
 * Ejecutar en Railway: node backend/migrations/seed-designs.js
 */
const db = require('../src/config/db');

const DESIGNS = [
  { name: 'Diseño 1', slug: 'diseno-1', image_url: '/img/sticker-1.png', is_available: 1, sort_order: 1 },
  { name: 'Diseño 2', slug: 'diseno-2', image_url: '/img/sticker-2.png', is_available: 1, sort_order: 2 },
  { name: 'Diseño 3', slug: 'diseno-3', image_url: '/img/sticker-3.png', is_available: 1, sort_order: 3 },
  { name: 'Diseño 4', slug: 'diseno-4', image_url: '/img/sticker-4.png', is_available: 1, sort_order: 4 },
  { name: 'Diseño 5', slug: 'diseno-5', image_url: '/img/sticker-5.png', is_available: 1, sort_order: 5 },
  { name: 'Diseño 6', slug: 'diseno-6', image_url: '/img/sticker-6.png', is_available: 1, sort_order: 6 },
  { name: 'Diseño 7', slug: 'diseno-7', image_url: '/img/sticker-7.png', is_available: 1, sort_order: 7 },
  { name: 'Diseño 8', slug: 'diseno-8', image_url: '/img/sticker-8.png', is_available: 1, sort_order: 8 },
  { name: 'Diseño 9', slug: 'diseno-9', image_url: '/img/sticker-9.png', is_available: 1, sort_order: 9 },
  { name: 'Diseño 10', slug: 'diseno-10', image_url: '/img/sticker-10.png', is_available: 1, sort_order: 10 },
];

(async () => {
  try {
    // Obtener o crear el producto sticker-qr-personalizado una sola vez
    let productId;
    const products = await db.query(
      "SELECT id FROM products WHERE slug = 'sticker-qr-personalizado' LIMIT 1"
    );

    if (!products || products.length === 0) {
      console.log('Creando producto sticker-qr-personalizado...');
      const result = await db.query(
        `INSERT INTO products (slug, name, price, currency, is_active, is_purchasable, is_visible, sort_order)
         VALUES ('sticker-qr-personalizado', 'Sticker QR personalizado', 29000, 'COP', 1, 1, 1, 1)`
      );
      productId = result.insertId;
      console.log(`Producto creado con id ${productId}`);
    } else {
      productId = products[0].id;
      console.log(`Producto sticker-qr-personalizado encontrado con id ${productId}`);
    }

    // Insertar o actualizar diseños
    for (const design of DESIGNS) {
      const existing = await db.query(
        'SELECT id FROM product_designs WHERE slug = ?',
        [design.slug]
      );

      if (existing.length > 0) {
        await db.query(
          `UPDATE product_designs SET name = ?, image_url = ?, is_available = ?, sort_order = ? WHERE slug = ?`,
          [design.name, design.image_url, design.is_available, design.sort_order, design.slug]
        );
        console.log(`Diseño actualizado: ${design.name}`);
      } else {
        await db.query(
          `INSERT INTO product_designs (product_id, name, slug, image_url, is_available, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [productId, design.name, design.slug, design.image_url, design.is_available, design.sort_order]
        );
        console.log(`Diseño creado: ${design.name}`);
      }
    }

    console.log('\nDiseños de stickers cargados correctamente.');
    console.log('Puedes acceder a ellos en: GET /api/designs?product_id=<id_del_producto>');
  } catch (error) {
    console.error('Error cargando diseños:', error.message);
    process.exit(1);
  } finally {
    try { await db.close(); } catch {}
    process.exit(0);
  }
})();
