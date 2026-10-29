const db = require('../../config/db');

const listContacts = async (req, res) => {
  const profile = await getOrCreateProfile(req.user.id);
  const rows = await db.query(
    'SELECT id, name, relationship, phone, email, is_public, display_phone, display_email, priority_order, created_at FROM emergency_contacts WHERE profile_id = ? ORDER BY priority_order ASC, id ASC',
    [profile.id]
  );
  return res.json({ contacts: rows });
};

const createContact = async (req, res) => {
  const { name, relationship, phone, email, is_public, display_phone, display_email, priority_order } = req.validated.body;
  const profile = await getOrCreateProfile(req.user.id);

  const result = await db.query(
    `INSERT INTO emergency_contacts (profile_id, name, relationship, phone, email, is_public, display_phone, display_email, priority_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      profile.id,
      name,
      relationship || '',
      phone || null,
      email || null,
      is_public === true ? 1 : 0,
      display_phone === true ? 1 : 0,
      display_email === true ? 1 : 0,
      priority_order || 0,
    ]
  );

  return res.status(201).json({ contact: { id: result.insertId, name, relationship, phone, email } });
};

const updateContact = async (req, res) => {
  const { id } = req.params;
  const { name, relationship, phone, email, is_public, display_phone, display_email, priority_order } = req.validated.body;
  const profile = await getOrCreateProfile(req.user.id);

  const existing = await db.query(
    'SELECT id FROM emergency_contacts WHERE id = ? AND profile_id = ?',
    [id, profile.id]
  );
  if (!existing) {
    return res.status(404).json({ error: 'Contacto no encontrado' });
  }

  await db.query(
    `UPDATE emergency_contacts
     SET name = COALESCE(?, name), relationship = COALESCE(?, relationship),
         phone = COALESCE(?, phone), email = COALESCE(?, email),
         is_public = COALESCE(?, is_public), display_phone = COALESCE(?, display_phone),
         display_email = COALESCE(?, display_email), priority_order = COALESCE(?, priority_order)
     WHERE id = ?`,
    [
      name, relationship, phone, email,
      is_public === undefined ? undefined : is_public ? 1 : 0,
      display_phone === undefined ? undefined : display_phone ? 1 : 0,
      display_email === undefined ? undefined : display_email ? 1 : 0,
      priority_order === undefined ? undefined : priority_order,
      id,
    ]
  );
  return res.json({ message: 'Contacto actualizado' });
};

const deleteContact = async (req, res) => {
  const { id } = req.params;
  const profile = await getOrCreateProfile(req.user.id);

  const existing = await db.query(
    'SELECT id FROM emergency_contacts WHERE id = ? AND profile_id = ?',
    [id, profile.id]
  );
  if (!existing) {
    return res.status(404).json({ error: 'Contacto no encontrado' });
  }

  await db.query('DELETE FROM emergency_contacts WHERE id = ?', [id]);
  return res.json({ message: 'Contacto eliminado' });
};

const getOrCreateProfile = async (userId) => {
  let rows = await db.query('SELECT id FROM emergency_profiles WHERE user_id = ?', [userId]);
  if (rows.length === 0) {
    const result = await db.query(
      'INSERT INTO emergency_profiles (user_id, display_name, is_active) VALUES (?, ?, 0)',
      [userId, '']
    );
    return { id: result.insertId };
  }
  return rows[0];
};

module.exports = {
  listContacts,
  createContact,
  updateContact,
  deleteContact,
};

