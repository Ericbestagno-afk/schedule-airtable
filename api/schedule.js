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

    const airtableBaseUrl =
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;

    /**
     * MISE À JOUR D'UNE LIGNE
     * Utilisé quand on coche/décoche Close
     * ou quand on modifie Heure de fermeture à la main.
     */
    if (req.method === "PATCH") {
      const { recordId, close, heureFermeture } = req.body || {};

      if (!recordId) {
        return res.status(400).json({
          error: "recordId manquant"
        });
      }

      const fieldsToUpdate = {};

      if (typeof close === "boolean") {
        fieldsToUpdate["Close"] = close;
      }

      if (typeof heureFermeture === "string") {
        fieldsToUpdate["Heure de fermeture"] = heureFermeture;
      }

      const updateResponse = await fetch(`${airtableBaseUrl}/${recordId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fields: fieldsToUpdate
        })
      });

      const updateData = await updateResponse.json();

      if (!updateResponse.ok) {
        return res.status(updateResponse.status).json({
          error: "Erreur Airtable lors de la mise à jour",
          details: updateData
        });
      }

      return res.status(200).json({
        ok: true,
        updated: updateData
      });
    }

    /**
     * LECTURE DU SCHEDULE DU JOUR
     */
    if (req.method === "GET") {
      const todayParis = new Intl.DateTimeFormat("fr-CA", {
        timeZone: "Europe/Paris",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());

      const formula = encodeURIComponent(`IS_SAME({Date}, '${todayParis}', 'day')`);

      const url =
        `${airtableBaseUrl}` +
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
          close: fields.Close || false,
          heureFermeture: fields["Heure de fermeture"] || "",
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
    }

    return res.status(405).json({
      error: "Méthode non autorisée"
    });

  } catch (error) {
    return res.status(500).json({
      error: "Erreur dans api/schedule.js",
      message: error.message
    });
  }
}
