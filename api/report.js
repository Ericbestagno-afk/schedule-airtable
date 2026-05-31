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
          AIRTABLE_TABLE_NAME: SCHEDULE_TABLE_NAME ? "OK" : "MANQUANT"
        }
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Méthode non autorisée",
        method: req.method
      });
    }

    let body = req.body;

    if (typeof body === "string") {
      body = JSON.parse(body);
    }

    const date = body?.date || getTodayParis();
    const remarque = body?.remarque || "";
    const events = Array.isArray(body?.events) ? body.events : [];

    const scheduleBaseUrl =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SCHEDULE_TABLE_NAME)}`;

    const reportsBaseUrl =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(REPORTS_TABLE_NAME)}`;

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

    async function updateScheduleEvents() {
      const records = events
        .filter(event => event && event.id)
        .map(event => ({
          id: event.id,
          fields: {
            Close: Boolean(event.close),
            "Heure de fermeture": event.heureFermeture || ""
          }
        }));

      const chunks = chunkArray(records, 10);
      const results = [];

      for (const chunk of chunks) {
        const data = await airtableFetch(scheduleBaseUrl, {
          method: "PATCH",
          body: JSON.stringify({
            records: chunk
          })
        });

        results.push(data);
      }

      return results;
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
              Envoyé: false
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
            Envoyé: false
          }
        })
      });
    }

    const scheduleUpdates = await updateScheduleEvents();
    const report = await saveReportRecord();

    return res.status(200).json({
      ok: true,
      date,
      updatedEvents: events.length,
      scheduleUpdates,
      report: {
        id: report.id,
        fields: report.fields
      }
    });

  } catch (error) {
    console.error("ERREUR API REPORT:", error);

    return res.status(error.status || 500).json({
      error: "Erreur serveur dans api/report.js",
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

function chunkArray(array, size) {
  const chunks = [];

  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }

  return chunks;
}
