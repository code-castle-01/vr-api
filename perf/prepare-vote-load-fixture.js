require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const residentRoster = require("../shared/resident-roster");

const DEFAULT_BASE_URL = "http://localhost:1337";
const DEFAULT_LIMIT = 300;
const DEFAULT_AGENDA_ITEM_ID = 11;
const DEMO_PASSWORD = "Simulacion-2026!";

const resolveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const buildPassword = (username) =>
  username.startsWith("SIM-")
    ? DEMO_PASSWORD
    : residentRoster.buildResidentPassword(username);

const outputPath = path.join(__dirname, "vote-load-fixture.json");

async function main() {
  const agendaItemId = resolveNumber(process.env.K6_AGENDA_ITEM_ID, DEFAULT_AGENDA_ITEM_ID);
  const userLimit = resolveNumber(process.env.K6_USER_LIMIT, DEFAULT_LIMIT);
  const baseUrl = (process.env.K6_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");

  const connection = await mysql.createConnection({
    host: process.env.DATABASE_HOST || "127.0.0.1",
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || "root",
    password: process.env.DATABASE_PASSWORD || "",
    database: process.env.DATABASE_NAME || "strapi",
  });

  try {
    const [[agendaItem]] = await connection.execute(
      `
        SELECT ai.id, ai.title, ai.status, ail.assembly_id
        FROM agenda_items ai
        INNER JOIN agenda_items_assembly_links ail ON ail.agenda_item_id = ai.id
        WHERE ai.id = ?
        LIMIT 1
      `,
      [agendaItemId],
    );

    if (!agendaItem) {
      throw new Error(`No se encontro la encuesta ${agendaItemId}.`);
    }

    const [options] = await connection.execute(
      `
        SELECT vo.id, vo.text
        FROM vote_options vo
        INNER JOIN vote_options_agenda_item_links voal ON voal.vote_option_id = vo.id
        WHERE voal.agenda_item_id = ?
        ORDER BY vo.id
      `,
      [agendaItemId],
    );

    if (!options.length) {
      throw new Error(`La encuesta ${agendaItemId} no tiene opciones de voto.`);
    }

    const [eligibleUsers] = await connection.execute(
      `
        SELECT u.id, u.username, u.unidad_privada, u.coeficiente
        FROM up_users u
        INNER JOIN up_users_role_links url ON url.user_id = u.id
        INNER JOIN up_roles r ON r.id = url.role_id AND r.type = 'authenticated'
        LEFT JOIN (
          SELECT DISTINCT vul.user_id
          FROM votes_agenda_item_links vail
          INNER JOIN votes_user_links vul ON vul.vote_id = vail.vote_id
          WHERE vail.agenda_item_id = ?
        ) pv ON pv.user_id = u.id
        LEFT JOIN (
          SELECT DISTINCT parul.user_id
          FROM proxy_authorizations_assembly_links paal
          INNER JOIN proxy_authorizations_represented_user_links parul
            ON parul.proxy_authorization_id = paal.proxy_authorization_id
          WHERE paal.assembly_id = ?
        ) pa ON pa.user_id = u.id
        WHERE COALESCE(u.estado_cartera, 0) = 0
          AND COALESCE(u.coeficiente, 0) > 0
          AND pv.user_id IS NULL
          AND pa.user_id IS NULL
        ORDER BY u.id
        LIMIT ?
      `,
      [agendaItemId, agendaItem.assembly_id, userLimit],
    );

    if (!eligibleUsers.length) {
      throw new Error("No se encontraron usuarios elegibles para la prueba.");
    }

    const optionId = Number(process.env.K6_VOTE_OPTION_ID || options[0].id);
    const selectedOption = options.find((option) => Number(option.id) === optionId);

    if (!selectedOption) {
      throw new Error(
        `La opcion ${optionId} no pertenece a la encuesta ${agendaItemId}.`,
      );
    }

    const fixture = {
      generatedAt: new Date().toISOString(),
      baseUrl,
      assemblyId: Number(agendaItem.assembly_id),
      agendaItemId: Number(agendaItem.id),
      agendaItemTitle: agendaItem.title,
      originalAgendaStatus: agendaItem.status,
      voteOptionId: Number(selectedOption.id),
      voteOptionText: selectedOption.text,
      users: eligibleUsers.map((user) => ({
        id: Number(user.id),
        identifier: user.username,
        password: buildPassword(user.username),
        residentAccessMode: user.username.startsWith("SIM-") ? null : "owner",
        unit: user.unidad_privada,
        weight: Number(user.coeficiente),
      })),
    };

    fs.writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

    console.log(
      JSON.stringify(
        {
          outputPath,
          agendaItemId: fixture.agendaItemId,
          originalAgendaStatus: fixture.originalAgendaStatus,
          voteOptionId: fixture.voteOptionId,
          usersPrepared: fixture.users.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
