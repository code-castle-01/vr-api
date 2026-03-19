require('dotenv').config();

const mysql = require('mysql2/promise');

const WEIGHT_SCALE = 6;
const formatWeight = (value) => Number(Math.max(0, Number(value) || 0).toFixed(WEIGHT_SCALE));

const parseAssemblyId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const buildConnectionConfig = () => {
  const databaseUrl = process.env.DATABASE_URL || process.env.MYSQL_PUBLIC_URL;

  if (databaseUrl) {
    return databaseUrl;
  }

  return {
    host: process.env.DATABASE_HOST || process.env.MYSQLHOST,
    port: Number(process.env.DATABASE_PORT || process.env.MYSQLPORT || 3306),
    user: process.env.DATABASE_USERNAME || process.env.MYSQLUSER || 'root',
    password:
      process.env.DATABASE_PASSWORD || process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD,
    database: process.env.DATABASE_NAME || process.env.MYSQLDATABASE || 'railway',
  };
};

async function run() {
  const assemblyId = parseAssemblyId(process.env.REPAIR_ASSEMBLY_ID || process.argv[2]);

  if (!assemblyId) {
    throw new Error('Debes indicar el assemblyId a recalcular.');
  }

  const connection = await mysql.createConnection(buildConnectionConfig());

  try {
    await connection.execute('ALTER TABLE votes MODIFY weight DECIMAL(12,6) NOT NULL');

    const [voteUsers] = await connection.execute(
      `
      SELECT DISTINCT vul.user_id AS userId
      FROM votes v
      INNER JOIN votes_user_links vul ON vul.vote_id = v.id
      INNER JOIN votes_agenda_item_links vail ON vail.vote_id = v.id
      INNER JOIN agenda_items_assembly_links aial ON aial.agenda_item_id = vail.agenda_item_id
      WHERE aial.assembly_id = ?
        AND vul.user_id IS NOT NULL
      ORDER BY vul.user_id ASC
      `,
      [assemblyId]
    );

    let updatedUsers = 0;
    let updatedVotes = 0;

    for (const row of voteUsers) {
      const userId = Number(row.userId);

      if (!Number.isInteger(userId) || userId <= 0) {
        continue;
      }

      const [[attendanceRow]] = await connection.execute(
        `
        SELECT a.access_mode AS accessMode
        FROM attendances a
        INNER JOIN attendances_user_links aul ON aul.attendance_id = a.id
        INNER JOIN attendances_assembly_links aal ON aal.attendance_id = a.id
        WHERE aal.assembly_id = ?
          AND aul.user_id = ?
        ORDER BY a.id DESC
        LIMIT 1
        `,
        [assemblyId, userId]
      );

      const [[userRow]] = await connection.execute(
        `
        SELECT id, coeficiente AS coefficient
        FROM up_users
        WHERE id = ?
        LIMIT 1
        `,
        [userId]
      );

      if (!userRow) {
        continue;
      }

      const ownWeight = Number(userRow.coefficient || 0);
      const accessMode = String(attendanceRow?.accessMode || 'owner').trim().toLowerCase() === 'proxy'
        ? 'proxy'
        : 'owner';

      const [declarationRows] = await connection.execute(
        `
        SELECT
          parul.user_id AS representedUserId,
          represented.coeficiente AS representedCoefficient
        FROM proxy_authorizations pa
        INNER JOIN proxy_authorizations_assembly_links paal
          ON paal.proxy_authorization_id = pa.id
        INNER JOIN proxy_authorizations_submitted_by_links pasbl
          ON pasbl.proxy_authorization_id = pa.id
        INNER JOIN proxy_authorizations_represented_user_links parul
          ON parul.proxy_authorization_id = pa.id
        INNER JOIN up_users represented
          ON represented.id = parul.user_id
        WHERE paal.assembly_id = ?
          AND pasbl.user_id = ?
          AND pa.status = 'submitted'
        ORDER BY pa.id ASC
        `,
        [assemblyId, userId]
      );

      let externalWeight = 0;
      let hasSelfDeclaration = false;

      for (const declaration of declarationRows) {
        const representedUserId = Number(declaration.representedUserId || 0);
        const representedWeight = Number(declaration.representedCoefficient || 0);

        if (representedUserId === userId) {
          hasSelfDeclaration = true;
          continue;
        }

        externalWeight += representedWeight;
      }

      const nextWeight =
        accessMode === 'owner'
          ? formatWeight(ownWeight + externalWeight)
          : formatWeight((hasSelfDeclaration ? ownWeight : 0) + externalWeight);

      const [updateResult] = await connection.execute(
        `
        UPDATE votes v
        INNER JOIN votes_user_links vul ON vul.vote_id = v.id
        INNER JOIN votes_agenda_item_links vail ON vail.vote_id = v.id
        INNER JOIN agenda_items_assembly_links aial ON aial.agenda_item_id = vail.agenda_item_id
        SET v.weight = ?
        WHERE aial.assembly_id = ?
          AND vul.user_id = ?
          AND ABS(v.weight - ?) > 0.0000001
        `,
        [nextWeight, assemblyId, userId, nextWeight]
      );

      const changedRows = Number(updateResult?.affectedRows || 0);

      if (changedRows > 0) {
        updatedUsers += 1;
        updatedVotes += changedRows;
      }
    }

    console.log(
      JSON.stringify(
        {
          assemblyId,
          updatedUsers,
          updatedVotes,
        },
        null,
        2
      )
    );
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error('Error fatal al recalcular pesos por SQL directo:', error.message);
  process.exit(1);
});
