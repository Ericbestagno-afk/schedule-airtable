import PDFDocument from "pdfkit";

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

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const REPORT_FROM_EMAIL = process.env.REPORT_FROM_EMAIL;

    if (
      !AIRTABLE_TOKEN ||
      !BASE_ID ||
      !SCHEDULE_TABLE_NAME ||
      !RESEND_API_KEY ||
      !REPORT_FROM_EMAIL
    ) {
      return res.status(500).json({
        error: "Variables Vercel manquantes",
        variables: {
          AIRTABLE_TOKEN: AIRTABLE_TOKEN ? "OK" : "MANQUANT",
          AIRTABLE_BASE_ID: BASE_ID ? "OK" : "MANQUANT",
          AIRTABLE_TABLE_NAME: SCHEDULE_TABLE_NAME ? "OK" : "MANQUANT",
          RESEND_API_KEY: RESEND_API_KEY ? "OK" : "MANQUANT",
          REPORT_FROM_EMAIL: REPORT_FROM_EMAIL ? "OK" : "MANQUANT"
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

    const pdfBase64 = pdfBuffer.toString("base64");
    const filename = `report-feed-${date}.pdf`;

    const resendPayload = {
      from: REPORT_FROM_EMAIL,
      to: recipients,
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
          content: pdfBase64
        }
      ]
    };

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(resendPayload)
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error("ERREUR RESEND:", resendData);
      console.error("DESTINATAIRES:", recipients);
      console.error("FROM:", REPORT_FROM_EMAIL);

      return res.status(resendResponse.status).json({
        error: "Erreur Resend lors de l'envoi email",
        resendStatus: resendResponse.status,
        resendDetails: resendData,
        from: REPORT_FROM_EMAIL,
        recipients,
        hint:
          "Avec onboarding@resend.dev, laisse actif uniquement l'email du compte Resend dans Airtable. Pour envoyer à plusieurs emails, vérifie un domaine dans Resend."
      });
    }

    let savedReport = null;
    let reportSaveError = null;

    try {
      savedReport = await saveReportRecord();
    } catch (error) {
      console.error("EMAIL ENVOYÉ MAIS ERREUR SAUVEGARDE REPORT:", error);
      reportSaveError = error.data || error.message || error;
    }

    return res.status(200).json({
      ok: true,
      date,
      recipients,
      resend: resendData,
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
    console.error("ERREUR SEND REPORT COMPLETE:", error);

    return res.status(error.status || 500).json({
      error: "Erreur serveur dans api/send-report.js",
      message: error.message || null,
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
      margin: 40
    });

    const chunks = [];

    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc
      .fontSize(20)
      .font("Helvetica-Bold")
      .fillColor("#111111")
      .text("OUVERTURE / FERMETURE DES FEED", {
        align: "center"
      });

    doc.moveDown(0.5);

    doc
      .fontSize(13)
      .font("Helvetica-Bold")
      .fillColor("#111111")
      .text(`Date : ${date}`, {
        align: "center"
      });

    doc.moveDown(1.2);

    const startX = 40;
    let y = doc.y;

    const columns = [
      { label: "Ouverture", width: 75 },
      { label: "Court", width: 60 },
      { label: "Feed", width: 220 },
      { label: "Close", width: 55 },
      { label: "Fermeture", width: 90 }
    ];

    drawTableHeader(doc, startX, y, columns);
    y += 24;

    events.forEach(event => {
      const rowHeight = 28;

      if (y + rowHeight > 760) {
        doc.addPage();
        y = 40;
        drawTableHeader(doc, startX, y, columns);
        y += 24;
      }

      const values = [
        event.heure || "",
        event.court || "",
        event.feed || "",
        event.close ? "Oui" : "Non",
        event.heureFermeture || ""
      ];

      drawTableRow(doc, startX, y, columns, values, rowHeight);
      y += rowHeight;
    });

    doc.moveDown(2);

    if (doc.y > 700) {
      doc.addPage();
    }

    doc
      .fontSize(13)
      .font("Helvetica-Bold")
      .fillColor("#111111")
      .text("Remarque :", 40, doc.y);

    doc.moveDown(0.4);

    doc
      .fontSize(11)
      .font("Helvetica")
      .fillColor("#111111")
      .text(remarque || "Aucune remarque.", {
        width: 500,
        align: "left"
      });

    doc.moveDown(2);

    doc
      .fontSize(9)
      .fillColor("#666666")
      .text(`PDF généré le ${new Date().toLocaleString("fr-FR", {
        timeZone: "Europe/Paris"
      })}`, {
        align: "right"
      });

    doc.end();
  });
}

function drawTableHeader(doc, x, y, columns) {
  let currentX = x;

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");

  columns.forEach(column => {
    doc
      .rect(currentX, y, column.width, 24)
      .fillAndStroke("#0f6680", "#ffffff");

    doc
      .fillColor("#ffffff")
      .text(column.label, currentX + 4, y + 7, {
        width: column.width - 8,
        height: 14
      });

    currentX += column.width;
  });
}

function drawTableRow(doc, x, y, columns, values, rowHeight) {
  let currentX = x;

  doc.font("Helvetica").fontSize(8).fillColor("#111111");

  columns.forEach((column, index) => {
    doc
      .rect(currentX, y, column.width, rowHeight)
      .fillAndStroke("#e6e9ec", "#ffffff");

    doc
      .fillColor("#111111")
      .text(values[index], currentX + 4, y + 7, {
        width: column.width - 8,
        height: rowHeight - 10,
        ellipsis: true
      });

    currentX += column.width;
  });
}
