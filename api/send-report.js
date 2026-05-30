import PDFDocument from "pdfkit";
import nodemailer from "nodemailer";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Méthode non autorisée",
        method: req.method
      });
    }

    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const SCHEDULE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
    const REPORTS_TABLE_NAME = process.env.AIRTABLE_REPORTS_TABLE_NAME || "Reports";
    const REPORT_EMAILS_TABLE_NAME =
      process.env.AIRTABLE_REPORT_EMAILS_TABLE_NAME || "Report Emails";

    const GMAIL_USER = process.env.GMAIL_USER;
    const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

    if (
      !AIRTABLE_TOKEN ||
      !BASE_ID ||
      !SCHEDULE_TABLE_NAME ||
      !GMAIL_USER ||
      !GMAIL_APP_PASSWORD
    ) {
      return res.status(500).json({
        error: "Variables Vercel manquantes",
        variables: {
          AIRTABLE_TOKEN: AIRTABLE_TOKEN ? "OK" : "MANQUANT",
          AIRTABLE_BASE_ID: BASE_ID ? "OK" : "MANQUANT",
          AIRTABLE_TABLE_NAME: SCHEDULE_TABLE_NAME ? "OK" : "MANQUANT",
          GMAIL_USER: GMAIL_USER ? "OK" : "MANQUANT",
          GMAIL_APP_PASSWORD: GMAIL_APP_PASSWORD ? "OK" : "MANQUANT"
        }
      });
    }

    let body = req.body;

    if (typeof body === "string") {
      body = JSON.parse(body);
    }

    const date = body?.date || getTodayParis();
    const remarque = body?.remarque || "";

    const scheduleBaseUrl =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SCHEDULE_TABLE_NAME)}`;

    const reportsBaseUrl =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(REPORTS_TABLE_NAME)}`;

    const emailsBaseUrl =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(REPORT_EMAILS_TABLE_NAME)}`;

    async function airtableFetch(url, options = {}) {
      const response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw {
          status: response.status,
          data
        };
      }

      return data;
    }

    async function getScheduleEvents() {
      const formula = encodeURIComponent(`IS_SAME({Date}, '${date}', 'day')`);

      const url =
        `${scheduleBaseUrl}` +
        `?filterByFormula=${formula}` +
        `&sort%5B0%5D%5Bfield%5D=Heure` +
        `&sort%5B0%5D%5Bdirection%5D=asc`;

      const data = await airtableFetch(url);
      const records = Array.isArray(data.records) ? data.records : [];

      return records.map(record => {
        const fields = record.fields || {};

        return {
          id: record.id,
          date: fields.Date || "",
          heure: fields.Heure || "",
          court: fields.Court || "",
          feed: fields.Feed || "",
          close: fields.Close || false,
          heureFermeture: fields["Heure de fermeture"] || ""
        };
      });
    }

    async function getActiveEmails() {
      const formula = encodeURIComponent(`AND({Actif}, {Email} != '')`);
      const url = `${emailsBaseUrl}?filterByFormula=${formula}`;

      const data = await airtableFetch(url);
      const records = Array.isArray(data.records) ? data.records : [];

      return records
        .map(record => record.fields?.Email)
        .filter(email => typeof email === "string" && email.includes("@"));
    }

    async function findReportRecord() {
      const formula = encodeURIComponent(`IS_SAME({Date}, '${date}', 'day')`);
      const url = `${reportsBaseUrl}?filterByFormula=${formula}&maxRecords=1`;

      const data = await airtableFetch(url);
      const records = Array.isArray(data.records) ? data.records : [];

      return records[0] || null;
    }

    async function saveReportRecord() {
      const existingReport = await findReportRecord();

      if (existingReport) {
        return airtableFetch(`${reportsBaseUrl}/${existingReport.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            fields: {
              Remarque: remarque,
              Envoyé: true
            }
          })
        });
      }

      return airtableFetch(reportsBaseUrl, {
        method: "POST",
        body: JSON.stringify({
          fields: {
            Date: date,
            Remarque: remarque,
            Envoyé: true
          }
        })
      });
    }

    const events = await getScheduleEvents();

    if (!events.length) {
      return res.status(400).json({
        error: "Aucune ligne trouvée pour cette date",
        date
      });
    }

    const allClosed = events.every(event => event.close === true);

    if (!allClosed) {
      return res.status(400).json({
        error: "Toutes les lignes du jour ne sont pas cochées",
        date,
        eventsNotClosed: events
          .filter(event => !event.close)
          .map(event => ({
            heure: event.heure,
            court: event.court,
            feed: event.feed
          }))
      });
    }

    const recipients = await getActiveEmails();

    if (!recipients.length) {
      return res.status(400).json({
        error: "Aucun email actif trouvé dans Airtable",
        table: REPORT_EMAILS_TABLE_NAME,
        expectedFields: ["Email", "Nom", "Actif"]
      });
    }

    const pdfBuffer = await generatePdfBuffer({
      date,
      events,
      remarque
    });

    const filename = `report-feed-${date}.pdf`;

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: GMAIL_USER,
        pass: String(GMAIL_APP_PASSWORD).replace(/\s/g, "")
      }
    });

    const mailResult = await transporter.sendMail({
      from: `"Report Feed" <${GMAIL_USER}>`,
      to: recipients.join(","),
      subject: `Report ouverture / fermeture des feed - ${date}`,
      html: `
        <p>Bonjour,</p>
        <p>Veuillez trouver en pièce jointe le report ouverture / fermeture des feed du ${escapeHtml(date)}.</p>
        ${
          remarque
            ? `<p><strong>Remarque :</strong><br>${escapeHtml(remarque).replace(/\n/g, "<br>")}</p>`
            : ""
        }
        <p>Cordialement.</p>
      `,
      attachments: [
        {
          filename,
          content: pdfBuffer,
          contentType: "application/pdf"
        }
      ]
    });

    let savedReport = null;
    let reportSaveError = null;

    try {
      savedReport = await saveReportRecord();
    } catch (error) {
      console.error("EMAIL GMAIL ENVOYÉ MAIS ERREUR SAUVEGARDE REPORT:", error);
      reportSaveError = error.data || error.message || error;
    }

    return res.status(200).json({
      ok: true,
      date,
      recipients,
      mail: {
        messageId: mailResult.messageId,
        accepted: mailResult.accepted,
        rejected: mailResult.rejected,
        response: mailResult.response
      },
      reportSaved: Boolean(savedReport),
      reportSaveError,
      report: savedReport
        ? {
            id: savedReport.id,
            envoye: savedReport.fields?.Envoyé || false
          }
        : null
    });

  } catch (error) {
    console.error("ERREUR SEND REPORT GMAIL COMPLETE:", error);

    return res.status(error.status || 500).json({
      error: "Erreur serveur dans api/send-report.js Gmail",
      message: error.message || null,
      code: error.code || null,
      command: error.command || null,
      response: error.response || null,
      responseCode: error.responseCode || null,
      details: error.data || error.details || error,
      stack: error.stack || null
    });
  }
}

function getTodayParis() {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function generatePdfBuffer({ date, events, remarque }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 24
    });

    const chunks = [];

    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc
      .fontSize(15)
      .font("Helvetica-Bold")
      .fillColor("#111111")
      .text("OUVERTURE / FERMETURE DES FEED", {
        align: "center"
      });

    doc.moveDown(0.25);

    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .fillColor("#111111")
      .text(`Date : ${date}`, {
        align: "center"
      });

    doc.moveDown(0.7);

    const startX = 24;
    let y = doc.y;

    const columns = [
      { label: "Ouverture", width: 80 },
      { label: "Court", width: 70 },
      { label: "Feed", width: 430 },
      { label: "Close", width: 55 },
      { label: "Fermeture", width: 95 }
    ];

    const headerHeight = 18;
    const maxY = 515;

    const availableHeightForRemark = remarque ? 62 : 26;
    const availableRowsHeight = maxY - y - headerHeight - availableHeightForRemark;

    const rowHeight = Math.max(
      12,
      Math.min(18, Math.floor(availableRowsHeight / Math.max(events.length, 1)))
    );

    const bodyFontSize = rowHeight <= 13 ? 6.5 : rowHeight <= 15 ? 7.2 : 8;
    const headerFontSize = 8;

    drawTableHeader(doc, startX, y, columns, headerHeight, headerFontSize);
    y += headerHeight;

    events.forEach(event => {
      const values = [
        event.heure || "",
        event.court || "",
        truncateText(event.feed || "", rowHeight <= 13 ? 80 : 110),
        event.close ? "Oui" : "Non",
        event.heureFermeture || ""
      ];

      drawTableRow(doc, startX, y, columns, values, rowHeight, bodyFontSize);
      y += rowHeight;
    });

    y += 10;

    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor("#111111")
      .text("Remarque :", 24, y);

    y += 12;

    const remarkText = remarque || "Aucune remarque.";
    const compactRemark = truncateText(remarkText, 360);

    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#111111")
      .text(compactRemark, 24, y, {
        width: 760,
        height: 45,
        align: "left"
      });

    doc
      .fontSize(7)
      .fillColor("#666666")
      .text(`PDF généré le ${new Date().toLocaleString("fr-FR", {
        timeZone: "Europe/Paris"
      })}`, 24, 555, {
        width: 780,
        align: "right"
      });

    doc.end();
  });
}

function truncateText(value, maxLength) {
  const text = String(value || "");

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength - 1) + "…";
}

function drawTableHeader(doc, x, y, columns, rowHeight, fontSize) {
  let currentX = x;

  doc.font("Helvetica-Bold").fontSize(fontSize).fillColor("#ffffff");

  columns.forEach(column => {
    doc
      .rect(currentX, y, column.width, rowHeight)
      .fillAndStroke("#0f6680", "#ffffff");

    doc
      .fillColor("#ffffff")
      .text(column.label, currentX + 3, y + 5, {
        width: column.width - 6,
        height: rowHeight - 4
      });

    currentX += column.width;
  });
}

function drawTableRow(doc, x, y, columns, values, rowHeight, fontSize) {
  let currentX = x;

  doc.font("Helvetica").fontSize(fontSize).fillColor("#111111");

  columns.forEach((column, index) => {
    doc
      .rect(currentX, y, column.width, rowHeight)
      .fillAndStroke("#e6e9ec", "#ffffff");

    doc
      .fillColor("#111111")
      .text(values[index], currentX + 3, y + 3, {
        width: column.width - 6,
        height: rowHeight - 4,
        ellipsis: true
      });

    currentX += column.width;
  });
}
