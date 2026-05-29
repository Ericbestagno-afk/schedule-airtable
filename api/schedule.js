{\rtf1\ansi\ansicpg1252\cocoartf2822
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\paperw11900\paperh16840\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx566\tx1133\tx1700\tx2267\tx2834\tx3401\tx3968\tx4535\tx5102\tx5669\tx6236\tx6803\pardirnatural\partightenfactor0

\f0\fs24 \cf0 export default async function handler(req, res) \{\
  const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;\
  const BASE_ID = process.env.AIRTABLE_BASE_ID;\
  const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;\
\
  const today = new Date().toISOString().split("T")[0];\
\
  const formula = encodeURIComponent(`IS_SAME(\{Date\}, '$\{today\}', 'day')`);\
\
  const url =\
    `https://api.airtable.com/v0/$\{BASE_ID\}/$\{encodeURIComponent(TABLE_NAME)\}` +\
    `?filterByFormula=$\{formula\}` +\
    `&sort%5B0%5D%5Bfield%5D=Heure` +\
    `&sort%5B0%5D%5Bdirection%5D=asc`;\
\
  try \{\
    const airtableResponse = await fetch(url, \{\
      headers: \{\
        Authorization: `Bearer $\{AIRTABLE_TOKEN\}`\
      \}\
    \});\
\
    const data = await airtableResponse.json();\
\
    if (!airtableResponse.ok) \{\
      return res.status(airtableResponse.status).json(\{\
        error: data.error || "Erreur Airtable"\
      \});\
    \}\
\
    const events = data.records.map(record => \{\
      const fields = record.fields;\
\
      return \{\
        id: record.id,\
        date: fields.Date || "",\
        heure: fields.Heure || "",\
        court: fields.Court || "",\
        feed: fields.Feed || "",\
        datetime: `$\{fields.Date\}T$\{fields.Heure\}:00`\
      \};\
    \});\
\
    res.status(200).json(events);\
  \} catch (error) \{\
    res.status(500).json(\{\
      error: "Erreur lors de la r\'e9cup\'e9ration du schedule"\
    \});\
  \}\
\}}