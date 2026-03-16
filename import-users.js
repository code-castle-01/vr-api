require('dotenv').config();

const path = require('path');
const xlsx = require('xlsx');
const Strapi = require('@strapi/strapi');

const DEFAULT_COEFFICIENT = 100;
const DEFAULT_EMAIL_DOMAIN = 'vegasdelrio.com';
const FIRST_DATA_ROW = 3;

const buildUserEmail = (unit) => `${unit.toLowerCase()}@${DEFAULT_EMAIL_DOMAIN}`;

const buildDefaultPassword = (unit) => `VR-${unit.toUpperCase()}`;

const readOwners = (xlsPath) => {
  const workbook = xlsx.readFile(xlsPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

  return rows
    .slice(FIRST_DATA_ROW)
    .map((row) => {
      const unit = row?.[0]?.toString().trim().toUpperCase();
      const fullName = row?.[1]?.toString().trim();

      if (!unit || !fullName) {
        return null;
      }

      return { unit, fullName };
    })
    .filter(Boolean);
};

async function importUsers() {
  const appContext = await Strapi.compile();
  const app = await Strapi(appContext).load();
  const xlsPath = path.join(__dirname, 'doc', 'LISTA ASISTENCIA REUNION ASAMBLEA 2026.xls');

  console.log('--- SINCRONIZANDO COPROPIETARIOS DESDE EXCEL ---');

  const owners = readOwners(xlsPath);
  const roles = await app.entityService.findMany('plugin::users-permissions.role', {
    filters: { type: 'authenticated' },
    fields: ['id'],
  });
  const authenticatedRoleId = roles[0]?.id;

  if (!authenticatedRoleId) {
    throw new Error('No se encontro el rol authenticated.');
  }

  let created = 0;
  let updated = 0;

  for (const owner of owners) {
    const existingUser = await app.db.query('plugin::users-permissions.user').findOne({
      where: { UnidadPrivada: owner.unit },
    });
    const payload = {
      username: owner.unit,
      email: buildUserEmail(owner.unit),
      provider: 'local',
      confirmed: true,
      blocked: false,
      role: authenticatedRoleId,
      NombreCompleto: owner.fullName,
      UnidadPrivada: owner.unit,
      Coeficiente: Number(existingUser?.Coeficiente ?? DEFAULT_COEFFICIENT),
      EstadoCartera: Boolean(existingUser?.EstadoCartera ?? false),
    };

    if (!existingUser) {
      await app.plugin('users-permissions').service('user').add({
        ...payload,
        password: buildDefaultPassword(owner.unit),
      });
      created += 1;
      console.log(`Creado: ${owner.unit} -> ${owner.fullName}`);
      continue;
    }

    await app.plugin('users-permissions').service('user').edit(existingUser.id, {
      ...payload,
      ...(!existingUser.password ? { password: buildDefaultPassword(owner.unit) } : {}),
    });
    updated += 1;
  }

  console.log(`Sincronizacion finalizada. Creados: ${created}. Actualizados: ${updated}.`);
  process.exit(0);
}

importUsers().catch((error) => {
  console.error('Error fatal:', error.message);
  process.exit(1);
});
