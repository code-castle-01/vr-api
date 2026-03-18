require('dotenv').config();

const Strapi = require('@strapi/strapi');
const bcrypt = require('bcryptjs');
const residentRoster = require('./shared/resident-roster');

const DEFAULT_COEFFICIENT = Number(residentRoster.DEFAULT_COEFFICIENT);
const PASSWORD_HASH_ROUNDS = 10;
const RESET_ALLOWED = String(process.env.ALLOW_PRODUCTION_RESET || '').trim().toLowerCase() === 'true';
const RESET_INCLUDE_MEETING_DOCUMENTS =
  String(process.env.RESET_INCLUDE_MEETING_DOCUMENTS || '').trim().toLowerCase() === 'true';

const normalizeResidentCoefficient = (value) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed === 100) {
    return DEFAULT_COEFFICIENT;
  }

  return parsed;
};

const describeTarget = () => ({
  database: process.env.DATABASE_NAME || process.env.MYSQLDATABASE || '(sin nombre)',
  host:
    process.env.DATABASE_HOST ||
    process.env.MYSQLHOST ||
    process.env.DATABASE_URL ||
    '(sin host)',
  nodeEnv: process.env.NODE_ENV || '(sin NODE_ENV)',
  publicUrl: process.env.PUBLIC_URL || '(sin PUBLIC_URL)',
});

const deleteManySafely = async (app, uid, label, params = {}) => {
  const query = app.db.query(uid);

  if (typeof query.deleteMany === 'function') {
    const result = await query.deleteMany(params);
    const count =
      typeof result === 'number'
        ? result
        : typeof result?.count === 'number'
          ? result.count
          : 0;

    console.log(`Eliminados ${count} registros de ${label}.`);
    return count;
  }

  const items = await query.findMany({
    ...params,
    select: ['id'],
  });

  for (const item of items) {
    await query.delete({
      where: {
        id: item.id,
      },
    });
  }

  console.log(`Eliminados ${items.length} registros de ${label}.`);
  return items.length;
};

const findAuthenticatedRoleId = async (app) => {
  const roles = await app.entityService.findMany('plugin::users-permissions.role', {
    filters: { type: 'authenticated' },
    fields: ['id'],
  });

  return roles[0]?.id ?? null;
};

const clearMeetingDocumentOwners = async (app) => {
  const documents = await app.entityService.findMany('api::meeting-document.meeting-document', {
    fields: ['id'],
  });

  for (const document of documents) {
    await app.entityService.update('api::meeting-document.meeting-document', document.id, {
      data: {
        uploaded_by: null,
      },
    });
  }

  if (documents.length > 0) {
    console.log(`Actualizados ${documents.length} documentos para desvincular uploaded_by.`);
  }
};

const recreateResidentsFromRoster = async (app, authenticatedRoleId) => {
  const xlsPath = residentRoster.resolveRosterPath(__dirname);
  const owners = residentRoster.readRosterOwners(xlsPath);
  const userService = app.plugin('users-permissions').service('user');

  let created = 0;
  let updated = 0;

  for (const owner of owners) {
    const existingUser = await app.db.query('plugin::users-permissions.user').findOne({
      where: { UnidadPrivada: owner.unit },
    });
    const payload = {
      username: owner.unit,
      email: residentRoster.buildResidentEmail(owner.unit),
      provider: 'local',
      confirmed: true,
      blocked: false,
      role: authenticatedRoleId,
      NombreCompleto: owner.fullName,
      UnidadPrivada: owner.unit,
      Coeficiente: normalizeResidentCoefficient(existingUser?.Coeficiente),
      EstadoCartera: Boolean(existingUser?.EstadoCartera ?? false),
      password: await bcrypt.hash(
        residentRoster.buildResidentPassword(owner.unit),
        PASSWORD_HASH_ROUNDS
      ),
    };

    if (!existingUser) {
      await userService.add(payload);
      created += 1;
      continue;
    }

    await userService.edit(existingUser.id, payload);
    updated += 1;
  }

  console.log(
    `Padron resincronizado. Residentes creados: ${created}. Residentes actualizados: ${updated}.`
  );
};

async function run() {
  if (!RESET_ALLOWED) {
    console.error(
      'Abortado. Debes establecer ALLOW_PRODUCTION_RESET=true para ejecutar este reseteo.'
    );
    process.exit(1);
  }

  const target = describeTarget();
  console.log('--- RESETEO PRODUCTIVO PREPARADO ---');
  console.log(`Entorno: ${target.nodeEnv}`);
  console.log(`Host/base: ${target.host}`);
  console.log(`Base de datos: ${target.database}`);
  console.log(`PUBLIC_URL: ${target.publicUrl}`);

  const appContext = await Strapi.compile();
  const app = await Strapi(appContext).load();

  try {
    const authenticatedRoleId = await findAuthenticatedRoleId(app);

    if (!authenticatedRoleId) {
      throw new Error('No se encontro el rol authenticated.');
    }

    await deleteManySafely(app, 'api::vote.vote', 'votos');
    await deleteManySafely(app, 'api::attendance.attendance', 'asistencias');
    await deleteManySafely(
      app,
      'api::proxy-authorization.proxy-authorization',
      'poderes'
    );
    await deleteManySafely(app, 'api::vote-option.vote-option', 'opciones de voto');
    await deleteManySafely(app, 'api::agenda-item.agenda-item', 'puntos del orden del dia');
    await deleteManySafely(app, 'api::assembly.assembly', 'asambleas');

    if (RESET_INCLUDE_MEETING_DOCUMENTS) {
      await deleteManySafely(
        app,
        'api::meeting-document.meeting-document',
        'documentos de asamblea'
      );
    } else {
      await clearMeetingDocumentOwners(app);
    }

    const residentUsers = await app.entityService.findMany(
      'plugin::users-permissions.user',
      {
        fields: ['id', 'UnidadPrivada'],
        populate: {
          role: {
            fields: ['id', 'type', 'name'],
          },
        },
      }
    );

    for (const resident of residentUsers) {
      const roleType = resident.role?.type?.toString().trim().toLowerCase();

      if (roleType !== 'authenticated') {
        continue;
      }

      await app.db.query('plugin::users-permissions.user').delete({
        where: {
          id: resident.id,
        },
      });
    }

    console.log('Residentes anteriores eliminados.');
    await recreateResidentsFromRoster(app, authenticatedRoleId);
    console.log(
      'Reseteo completado. Produccion queda limpia en datos operativos y con residentes recreados usando contraseña = unidad y coeficiente por defecto actualizado.'
    );
  } finally {
    if (typeof app.destroy === 'function') {
      await app.destroy();
    }
  }
}

run().catch((error) => {
  console.error('Error fatal durante el reseteo:', error.message);
  process.exit(1);
});
