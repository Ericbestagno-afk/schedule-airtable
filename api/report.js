export default async function handler(req, res) {
  try {
    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
    const BASE_ID = process.env.AIRTABLE_BASE_ID;

    const SCHEDULE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
    const REPORTS_TABLE_NAME = process.env.AIRTABLE_REPORTS_TABLE_NAME || "Reports";

    if (!AIRTABLE_TOKEN || !BASE_ID || !SCHEDULE_TABLE_NAME) {
      return res.status(500).json({
        error: "Variables Vercel manquantes",
        variables: {
          AIRTABLE_TOKEN: AIRTABLE_TOKEN ? "OK" : "MANQUANT",
          AIRTABLE_BASE_ID: BASE_ID ? "OK" : "MANQUANT",
          AIRTABLE_TABLE_NAME: SCHEDULE_TABLE_NAME ? "OK" : "MANQUANT",
          AIRTABLE_REPORTS_TABLE_NAME: REPORTS_TABLE_NAME ? "OK" : "Reports par défaut"
        }
      });
    }

    const scheduleBaseUrl =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SCHEDULE_TABLE_NAME)}`;

    const reportsBaseUrl =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(REPORTS_TABLE_NAME)}`;

    function getTodayParis() {
      return new Intl.DateTimeFormat("fr-CA", {
        timeZone: "Europe/Paris",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());
    }

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

    async function getScheduleEvents(date) {
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

    async function findReportRecord(date) {
      const formula = encodeURIComponent(`IS_SAME({Date}, '${date}', 'day')`);
      const url = `${reportsBaseUrl}?filterByFormula=${formula}&maxRecords=1`;

      const data = await airtableFetch(url);
      const records = Array.isArray(data.records) ? data.records : [];

      return records[0] || null;
    }

    async function createReportRecord(date, remarque) {
      return airtableFetch(reportsBaseUrl, {
        method: "POST",
        body: JSON.stringify({
          fields: {
            Date: date,
            Remarque: remarque || "",
            Envoyé: false
          }
        })
      });
    }

    async function updateReportRecord(recordId, remarque) {
      return airtableFetch(`${reportsBaseUrl}/${recordId}`, {
        method: "PATCH",
        body: JSON.stringify({
          fields: {
            Remarque: remarque || ""
          }
        })
      });
    }

    if (req.method === "GET") {
      const date = req.query.date || getTodayParis();

      const events = await getScheduleEvents(date);
      const reportRecord = await findReportRecord(date);

      return res.status(200).json({
        ok: true,
        date,
        events,
        report: reportRecord
          ? {
              id: reportRecord.id,
              remarque: reportRecord.fields?.Remarque || "",
              envoye: reportRecord.fields?.Envoyé || false,
              dateEnvoi: reportRecord.fields?.["Date envoi"] || ""
            }
          : {
              id: null,
              remarque: "",
              envoye: false,
              dateEnvoi: ""
            }
      });
    }

    if (req.method === "POST") {
      let body = req.body;

      if (typeof body === "string") {
        body = JSON.parse(body);
      }

      const date = body?.date || getTodayParis();
      const remarque = body?.remarque || "";

      const existingReport = await findReportRecord(date);

      let savedReport;

      if (existingReport) {
        savedReport = await updateReportRecord(existingReport.id, remarque);
      } else {
        savedReport = await createReportRecord(date, remarque);
      }

      return res.status(200).json({
        ok: true,
        date,
        report: {
          id: savedReport.id,
          remarque: savedReport.fields?.Remarque || "",
          envoye: savedReport.fields?.Envoyé || false,
          dateEnvoi: savedReport.fields?.["Date envoi"] || ""
        }
      });
    }

    return res.status(405).json({
      error: "Méthode non autorisée",
      method: req.method
    });

  } catch (error) {
    return res.status(error.status || 500).json({
      error: "Erreur serveur dans api/report.js",
      details: error.data || error.message || error
    });
  }
}
