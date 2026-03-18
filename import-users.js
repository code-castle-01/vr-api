require('dotenv').config();

const Strapi = require('@strapi/strapi');
const bcrypt = require('bcryptjs');
const residentRoster = require('./shared/resident-roster');

const DEFAULT_COEFFICIENT = Number(residentRoster.DEFAULT_COEFFICIENT);
const buildUserEmail = (unit) => residentRoster.buildResidentEmail(unit);
const buildDefaultPassword = (unit) => residentRoster.buildResidentPassword(unit);
const readOwners = (xlsPath) => residentRoster.readRosterOwners(xlsPath);
const PASSWORD_HASH_ROUNDS = 10;
const normalizeResidentCoefficient = (value) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed === 100) {
    return DEFAULT_COEFFICIENT;
  }

  return parsed;
};

async function importUsers() {
  const appContext = await Strapi.compile();
  const app = await Strapi(appContext).load();
  const xlsPath = residentRoster.resolveRosterPath(__dirname);

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
      Coeficiente: normalizeResidentCoefficient(existingUser?.Coeficiente),
      EstadoCartera: Boolean(existingUser?.EstadoCartera ?? false),
    };

    if (!existingUser) {
      await app.plugin('users-permissions').service('user').add({
        ...payload,
        password: await bcrypt.hash(buildDefaultPassword(owner.unit), PASSWORD_HASH_ROUNDS),
      });
      created += 1;
      console.log(`Creado: ${owner.unit} -> ${owner.fullName}`);
      continue;
    }

    await app.plugin('users-permissions').service('user').edit(existingUser.id, {
      ...payload,
      password: await bcrypt.hash(buildDefaultPassword(owner.unit), PASSWORD_HASH_ROUNDS),
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
