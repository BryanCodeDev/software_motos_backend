const contactService = require('./contact.service');

const listContacts = async (req, res) => contactService.listContacts(req, res);
const createContact = async (req, res) => contactService.createContact(req, res);
const updateContact = async (req, res) => contactService.updateContact(req, res);
const deleteContact = async (req, res) => contactService.deleteContact(req, res);

module.exports = {
  listContacts,
  createContact,
  updateContact,
  deleteContact,
};

