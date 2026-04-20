const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { QueryTypes } = require('sequelize');
const config = require('../config');
const { Certificate, sequelize } = require('../models');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function getUserName(userId) {
  const rows = await sequelize.query('SELECT name FROM users WHERE id = :id LIMIT 1', {
    replacements: { id: userId },
    type: QueryTypes.SELECT,
  });
  return rows[0]?.name || 'Learner';
}

function nextCertificateNumber() {
  const y = new Date().getFullYear();
  const rand = crypto.randomBytes(4).readUInt32BE(0) % 100000000;
  return `CSC-${y}-${String(rand).padStart(8, '0')}`;
}

function verificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate PDF buffer for a certificate.
 */
async function buildPdfBuffer({ learnerName, courseTitle, certificateNumber, issuedAt, verifyUrl }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(28).text('Certificate of Completion', { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(14).text('This certifies that', { align: 'center' });
    doc.moveDown();
    doc.fontSize(22).text(learnerName, { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text('has successfully completed', { align: 'center' });
    doc.moveDown();
    doc.fontSize(18).text(courseTitle, { align: 'center' });
    doc.moveDown(3);
    doc.fontSize(11).fillColor('#444').text(`Certificate No: ${certificateNumber}`, { align: 'center' });
    doc.text(`Issued: ${issuedAt.toISOString().slice(0, 10)}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(9).text(`Verify: ${verifyUrl}`, { align: 'center' });
    doc.end();
  });
}

/**
 * Issue certificate if not already issued for (userId, courseId).
 */
async function issueCertificateIfEligible({ userId, courseId, courseTitle }) {
  const existing = await Certificate.findOne({
    where: { user_id: userId, course_id: courseId },
  });
  if (existing) return existing.get({ plain: true });

  const learnerName = await getUserName(userId);
  const certificateNumber = nextCertificateNumber();
  const token = verificationToken();
  const issuedAt = new Date();
  const verifyUrl = `${config.publicSiteUrl.replace(/\/$/, '')}/verify-certificate?token=${token}`;

  const pdfBuffer = await buildPdfBuffer({
    learnerName,
    courseTitle: courseTitle || 'Course',
    certificateNumber,
    issuedAt,
    verifyUrl,
  });

  const uploadRoot = path.isAbsolute(config.certificatesUploadDir)
    ? config.certificatesUploadDir
    : path.join(process.cwd(), config.certificatesUploadDir);
  ensureDir(uploadRoot);
  const filename = `${certificateNumber}.pdf`;
  const absPath = path.join(uploadRoot, filename);
  fs.writeFileSync(absPath, pdfBuffer);

  const relativeUrl = `/uploads/certificates/${filename}`;

  try {
    const row = await Certificate.create({
      user_id: userId,
      course_id: courseId,
      certificate_number: certificateNumber,
      issued_at: issuedAt,
      pdf_url: relativeUrl,
      verification_token: token,
      created_at: issuedAt,
    });
    return row.get({ plain: true });
  } catch (e) {
    const existing = await Certificate.findOne({ where: { user_id: userId, course_id: courseId } });
    if (existing) return existing.get({ plain: true });
    throw e;
  }
}

async function getCertificateForDownload(userId, courseId) {
  const row = await Certificate.findOne({
    where: { user_id: userId, course_id: courseId },
  });
  if (!row) return null;
  const plain = row.get({ plain: true });
  const uploadRoot = path.isAbsolute(config.certificatesUploadDir)
    ? config.certificatesUploadDir
    : path.join(process.cwd(), config.certificatesUploadDir);
  const filename = path.basename(plain.pdf_url || `${plain.certificate_number}.pdf`);
  const absPath = path.join(uploadRoot, filename);
  if (!fs.existsSync(absPath)) return null;
  return { absPath, certificateNumber: plain.certificate_number, mimeType: 'application/pdf' };
}

async function verifyByToken(token) {
  const row = await Certificate.findOne({ where: { verification_token: token } });
  if (!row) return null;
  const c = row.get({ plain: true });
  const courseRows = await sequelize.query(
    'SELECT title FROM courses WHERE id = :id LIMIT 1',
    { replacements: { id: c.course_id }, type: QueryTypes.SELECT }
  );
  const userRows = await sequelize.query(
    'SELECT name FROM users WHERE id = :id LIMIT 1',
    { replacements: { id: c.user_id }, type: QueryTypes.SELECT }
  );
  return {
    certificate_number: c.certificate_number,
    issued_at: c.issued_at,
    learner_name: userRows[0]?.name || null,
    course_title: courseRows[0]?.title || null,
  };
}

module.exports = {
  issueCertificateIfEligible,
  getCertificateForDownload,
  verifyByToken,
  buildPdfBuffer,
};
