export default async function handler(req, res) {
  try {
    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;

    if (!AIRTABLE_TOKEN || !BASE_ID || !TABLE_NAME) {
      return res.status(500).json({
        error: "Variables Vercel manquantes",
        variables: {
          AIRTABLE_TOKEN: AIRTABLE_TOKEN ? "OK" : "MANQUANT",
          AIRTABLE_BASE_ID: BASE_ID ? "OK" : "MANQUANT",
          AIRTABLE_TABLE_NAME: TABLE_NAME ? "OK" : "MANQUANT"
        }
      });
    }

    const todayParis = new Intl.DateTimeFormat("fr-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

    const formula = encodeURIComponent(`IS_SAME({Date}, '${todayParis}', 'day')`);

    const url =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}` +
      `?filterByFormula=${formula}` +
      `&sort%5B0%5D%5Bfield%5D=Heure` +
      `&sort%5B0%5D%5Bdirection%5D=asc`;

    const airtableResponse = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    const data = await airtableResponse.json();

    if (!airtableResponse.ok) {
      return res.status(airtableResponse.status).json({
        error: "Erreur Airtable",
        status: airtableResponse.status,
        airtableMessage: data
      });
    }

    const records = Array.isArray(data.records) ? data.records : [];

    const events = records.map(record => {
      const fields = record.fields || {};

      return {
        id: record.id,
        date: fields.Date || "",
        heure: fields.Heure || "",
        court: fields.Court || "",
        feed: fields.Feed || "",
        datetime:
          fields.Date && fields.Heure
            ? `${fields.Date}T${fields.Heure}:00`
            : null
      };
    });

    return res.status(200).json({
      ok: true,
      todayParis,
      count: events.length,
      events
    });

  } catch (error) {
    return res.status(500).json({
      error: "Erreur dans api/schedule.js",
      message: error.message
    });
  }
}
