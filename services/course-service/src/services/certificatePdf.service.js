const PDFDocument = require('pdfkit');

/**
 * Server-side PDF rendering of a certificate, used only for the copy attached to email.
 *
 * This is a plain text layout and deliberately NOT the designed certificate: the artwork the
 * learner/claimant downloads is rendered client-side from CertificateArtwork and captured as a
 * PNG. Matching them server-side would mean headless Chromium inside a service that currently
 * only serves course reads. If the client wants the emailed file to match the download exactly,
 * that is the change to cost — say so rather than tweaking this layout.
 *
 * Shared by the learner certificate email and the public certificate-link claim email.
 */
function buildCertificatePdfBuffer({ studentName, courseTitle, completionDate, certificateNumber }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc
        .fontSize(24)
        .fillColor('#1e3a5f')
        .text('Study Cafe', { align: 'center' })
        .moveDown(0.5);

      doc
        .fontSize(18)
        .fillColor('#111827')
        .text('Certificate of Completion', { align: 'center' })
        .moveDown(1.5);

      doc
        .fontSize(12)
        .fillColor('#374151')
        .text('This is to certify that', { align: 'center' })
        .moveDown(0.5);

      doc
        .fontSize(22)
        .fillColor('#111827')
        .text(studentName || 'Learner', { align: 'center' })
        .moveDown(0.8);

      doc
        .fontSize(12)
        .fillColor('#374151')
        .text('has successfully completed the course', { align: 'center' })
        .moveDown(0.5);

      doc
        .fontSize(16)
        .fillColor('#111827')
        .text(courseTitle || 'Course', { align: 'center' })
        .moveDown(1.2);

      doc
        .fontSize(12)
        .fillColor('#374151')
        .text(`Completion date: ${completionDate || '—'}`, { align: 'center' })
        .moveDown(0.4);

      // The serial was always passed in and never printed — the number on the PDF and the number
      // on the downloaded artwork have to agree.
      doc
        .fontSize(12)
        .fillColor('#374151')
        .text(`Certificate Serial No. ${certificateNumber || '—'}`, { align: 'center' })
        .moveDown(2);

      doc
        .fontSize(10)
        .fillColor('#6b7280')
        .text('This certificate was generated automatically.', { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { buildCertificatePdfBuffer };
