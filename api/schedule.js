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

    // =========================
    // PATCH : mise à jour Close / Heure de fermeture
    // =========================
    if (req.method === "PATCH") {
      let body = req.body;

      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch (error) {
          return res.status(400).json({
            error: "Body JSON invalide",
            rawBody: req.body
          });
        }
      }

      const { recordId, close, heureFermeture } = body || {};

      if (!recordId) {
        return res.status(400).json({
          error: "recordId manquant",
          receivedBody: body
        });
      }

      const fieldsToUpdate = {};

      if (typeof close === "boolean") {
        fieldsToUpdate["Close"] = close;
      }

      if (typeof heureFermeture === "string") {
        fieldsToUpdate["Heure de fermeture"] = heureFermeture;
      }

      if (Object.keys(fieldsToUpdate).length === 0) {
        return res.status(400).json({
          error: "Aucun champ à mettre à jour",
          receivedBody: body
        });
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
          status: updateResponse.status,
          sentFields: fieldsToUpdate,
          airtableMessage: updateData
        });
      }

      return res.status(200).json({
        ok: true,
        updated: updateData
      });
    }

    // =========================
    // GET : lecture du schedule
    // Récupère :
    // - les lignes du jour
    // - les anciennes lignes non cochées
    // =========================
    if (req.method === "GET") {
      const todayParis = new Intl.DateTimeFormat("fr-CA", {
        timeZone: "Europe/Paris",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());

      const formula = encodeURIComponent(`
        OR(
          IS_SAME({Date}, '${todayParis}', 'day'),
          AND(
            IS_BEFORE({Date}, '${todayParis}'),
            NOT({Close})
          )
        )
      `);

      const url =
        `${airtableBaseUrl}` +
        `?filterByFormula=${formula}` +
        `&sort%5B0%5D%5Bfield%5D=Date` +
        `&sort%5B0%5D%5Bdirection%5D=asc` +
        `&sort%5B1%5D%5Bfield%5D=Heure` +
        `&sort%5B1%5D%5Bdirection%5D=asc`;

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
      error: "Méthode non autorisée",
      method: req.method
    });

  } catch (error) {
    return res.status(500).json({
      error: "Erreur serveur dans api/schedule.js",
      message: error.message
    });
  }
}
