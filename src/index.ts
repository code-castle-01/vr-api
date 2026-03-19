const path = require('path');
const bcrypt = require('bcryptjs');

type StrapiApp = {
  db: {
    lifecycles?: {
      subscribe: (options: {
        beforeCreate?: (event: {
          params: {
            data?: Record<string, unknown>;
          };
        }) => Promise<void> | void;
        beforeUpdate?: (event: {
          params: {
            data?: Record<string, unknown>;
          };
        }) => Promise<void> | void;
        models: string[];
      }) => void;
    };
    query: (uid: string) => {
      findMany?: (params: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
      findOne: (params: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
    };
  };
  entityService: {
    findMany: (uid: string, params?: Record<string, unknown>) => Promise<Array<{ id: number }>>;
    update?: (uid: string, entityId: number, params: Record<string, unknown>) => Promise<unknown>;
  };
  plugin: (name: string) => {
    service: (serviceName: string) => Record<string, unknown>;
  };
  log: {
    info: (message: string) => void;
    error: (message: string) => void;
    warn: (message: string) => void;
  };
  server?: {
    routes: (
      routes: Array<{
        method: string;
        path: string;
        handler: (ctx: { body?: unknown; status?: number; set: (name: string, value: string) => void }) => void;
        config?: {
          auth?: boolean;
        };
      }>
    ) => void;
  };
};

const residentRoster = require(path.resolve(process.cwd(), 'shared', 'resident-roster'));
const { repairStoredVoteWeights } = require('./utils/vote-weight');

type AssemblyOwnerRow = {
  fullName: string;
  unit: string;
};

const DEFAULT_COEFFICIENT = Number(residentRoster.DEFAULT_COEFFICIENT);
const buildUserEmail = (unit: string): string =>
  residentRoster.buildResidentEmail(unit);
const buildDefaultPassword = (unit: string): string =>
  residentRoster.buildResidentPassword(unit);
const normalizeUnit = (value: string): string => residentRoster.normalizeUnit(value);
const PASSWORD_HASH_ROUNDS = 10;
const isHashedPassword = (value: unknown): value is string =>
  typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
const normalizeResidentCoefficient = (value: unknown) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed === 100) {
    return DEFAULT_COEFFICIENT;
  }

  return parsed;
};

const isRoleValueMissing = (value: unknown) => {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === 'string') {
    return value.trim().length === 0;
  }

  if (typeof value === 'number') {
    return !Number.isFinite(value) || value <= 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === 'object') {
    const relationRecord = value as Record<string, unknown>;

    if ('id' in relationRecord) {
      return isRoleValueMissing(relationRecord.id);
    }

    if ('connect' in relationRecord) {
      const connectValue = relationRecord.connect;

      if (Array.isArray(connectValue)) {
        return connectValue.length === 0;
      }

      return isRoleValueMissing(connectValue);
    }
  }

  return false;
};

const AUTHENTICATED_ACTIONS = [
  'api::account.account.me',
  'api::account.account.updateMe',
  'api::meeting-document.meeting-document.library',
  'api::meeting-document.meeting-document.libraryOne',
  'api::proxy-authorization.proxy-authorization.mine',
  'api::proxy-authorization.proxy-authorization.availableResidents',
  'api::proxy-authorization.proxy-authorization.lock',
  'api::proxy-authorization.proxy-authorization.submit',
  'api::vote.vote.ballot',
  'api::vote.vote.cast',
];

const ADMIN_ACTIONS = [
  'api::assembly.assembly.adminExhaustiveReport',
  'api::legal-acceptance.legal-acceptance.adminList',
  'api::meeting-document.meeting-document.adminList',
  'api::meeting-document.meeting-document.adminOne',
  'api::meeting-document.meeting-document.adminCreate',
  'api::meeting-document.meeting-document.adminUpdate',
  'api::meeting-document.meeting-document.adminDelete',
  'api::proxy-authorization.proxy-authorization.adminByAssembly',
  'api::proxy-authorization.proxy-authorization.adminRevoke',
  'api::vote.vote.adminRepairWeights',
];

type AssemblyRow = {
  id: number;
};

type ProxyAuthorizationRow = {
  id: number;
};

const readAssemblyOwners = (filePath: string): AssemblyOwnerRow[] =>
  residentRoster.readRosterOwners(filePath);

const normalizeRawRows = (rawResult: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(rawResult)) {
    if (Array.isArray(rawResult[0])) {
      return rawResult[0] as Array<Record<string, unknown>>;
    }

    return rawResult as Array<Record<string, unknown>>;
  }

  return [];
};

const ensureResidentCoefficientPrecision = async (strapi: StrapiApp) => {
  const dbConnection = (strapi as any).db?.connection;
  const client = dbConnection?.client?.config?.client;

  if (client !== 'mysql' && client !== 'mysql2') {
    return;
  }

  if (typeof dbConnection?.raw !== 'function') {
    strapi.log.warn('No fue posible verificar la precision de coeficiente en la base de datos.');
    return;
  }

  const rawColumns = await dbConnection.raw("SHOW COLUMNS FROM up_users LIKE 'coeficiente'");
  const [column] = normalizeRawRows(rawColumns);
  const currentType = String(column?.Type ?? '').toLowerCase();

  if (currentType === 'decimal(12,6)') {
    return;
  }

  await dbConnection.raw(
    `ALTER TABLE up_users MODIFY coeficiente DECIMAL(12,6) NULL DEFAULT ${DEFAULT_COEFFICIENT}`
  );

  strapi.log.info('Precision de coeficiente ajustada a DECIMAL(12,6).');
};

const ensureVoteWeightPrecision = async (strapi: StrapiApp) => {
  const dbConnection = (strapi as any).db?.connection;
  const client = dbConnection?.client?.config?.client;

  if (client !== 'mysql' && client !== 'mysql2') {
    return;
  }

  if (typeof dbConnection?.raw !== 'function') {
    strapi.log.warn('No fue posible verificar la precision de weight en la base de datos.');
    return;
  }

  const rawColumns = await dbConnection.raw("SHOW COLUMNS FROM votes LIKE 'weight'");
  const [column] = normalizeRawRows(rawColumns);
  const currentType = String(column?.Type ?? '').toLowerCase();

  if (currentType === 'decimal(12,6)') {
    return;
  }

  await dbConnection.raw('ALTER TABLE votes MODIFY weight DECIMAL(12,6) NOT NULL');
  strapi.log.info('Precision de weight ajustada a DECIMAL(12,6).');
};

const repairPersistedVoteWeights = async (strapi: StrapiApp) => {
  const summary = await repairStoredVoteWeights(strapi);

  if (summary.updatedVotes > 0) {
    strapi.log.info(
      `Pesos de voto recalculados. Asambleas: ${summary.assemblies.length}. Usuarios ajustados: ${summary.updatedUsers}. Votos ajustados: ${summary.updatedVotes}.`
    );
    return;
  }

  strapi.log.info('Pesos de voto verificados sin cambios pendientes.');
};

const runDeferredStartupTask = (
  strapi: StrapiApp,
  label: string,
  task: () => Promise<void>
) => {
  setTimeout(() => {
    void (async () => {
      strapi.log.info(`Iniciando tarea posarranque: ${label}.`);

      try {
        await task();
        strapi.log.info(`Tarea posarranque completada: ${label}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido';
        strapi.log.error(`Fallo la tarea posarranque ${label}: ${message}`);
      }
    })();
  }, 0);
};

const resolveRoleId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const relationRecord = value as Record<string, unknown>;

  if (typeof relationRecord.id === 'number') {
    return relationRecord.id;
  }

  if (typeof relationRecord.connect === 'number') {
    return relationRecord.connect;
  }

  if (Array.isArray(relationRecord.connect)) {
    const connectedEntry = relationRecord.connect[0];

    if (typeof connectedEntry === 'number') {
      return connectedEntry;
    }

    if (
      connectedEntry &&
      typeof connectedEntry === 'object' &&
      typeof (connectedEntry as Record<string, unknown>).id === 'number'
    ) {
      return (connectedEntry as Record<string, number>).id;
    }
  }

  return null;
};

const applyResidentDefaults = async (
  data: Record<string, unknown>,
  authenticatedRoleId: number
) => {
  const fallbackUnitSource =
    typeof data.UnidadPrivada === 'string'
      ? data.UnidadPrivada
      : typeof data.username === 'string'
        ? data.username
        : '';
  const normalizedUnit = normalizeUnit(fallbackUnitSource);
  const resolvedRoleId = resolveRoleId(data.role);
  const shouldTreatAsResident =
    normalizedUnit.length > 0 &&
    (resolvedRoleId === null || resolvedRoleId === authenticatedRoleId);

  if (!shouldTreatAsResident) {
    return;
  }

  data.UnidadPrivada = normalizedUnit;
  data.username = normalizedUnit;
  data.email = buildUserEmail(normalizedUnit);
  data.password = buildDefaultPassword(normalizedUnit);

  data.Coeficiente = normalizeResidentCoefficient(data.Coeficiente);

  if (!isHashedPassword(data.password)) {
    data.password = await bcrypt.hash(String(data.password), PASSWORD_HASH_ROUNDS);
  }
};

const syncAssemblyOwners = async (strapi: StrapiApp, owners: AssemblyOwnerRow[]): Promise<void> => {
  const userService = strapi.plugin('users-permissions').service('user') as {
    add: (data: Record<string, unknown>) => Promise<unknown>;
    edit: (id: number, data: Record<string, unknown>) => Promise<unknown>;
  };
  const authenticatedRoleId = await findAuthenticatedRoleId(strapi);

  if (!authenticatedRoleId) {
    strapi.log.warn('No se encontro el rol authenticated; se omite la sincronizacion del padron.');
    return;
  }

  let created = 0;
  let updated = 0;

  for (const owner of owners) {
    const existingUser = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { UnidadPrivada: owner.unit },
    });
    const baseData: Record<string, unknown> = {
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
      await userService.add({
        ...baseData,
        password: buildDefaultPassword(owner.unit),
      });
      created += 1;
      continue;
    }

    await userService.edit(existingUser.id as number, {
      ...baseData,
      password: buildDefaultPassword(owner.unit),
    });
    updated += 1;
  }

  strapi.log.info(
    `Sincronizacion de copropietarios completada. Creados: ${created}. Actualizados: ${updated}.`
  );
};

const findAuthenticatedRoleId = async (strapi: StrapiApp) => {
  const roles = await strapi.entityService.findMany('plugin::users-permissions.role', {
    filters: { type: 'authenticated' },
    fields: ['id'],
  });

  return roles[0]?.id;
};

const registerDefaultUserRoleHook = async (strapi: StrapiApp) => {
  if (!strapi.db.lifecycles?.subscribe) {
    strapi.log.warn(
      'No fue posible registrar el rol por defecto para usuarios porque la API de lifecycles no está disponible.'
    );
    return;
  }

  const authenticatedRoleId = await findAuthenticatedRoleId(strapi);

  if (!authenticatedRoleId) {
    strapi.log.warn('No se encontro el rol authenticated; no se pudo registrar el rol por defecto.');
    return;
  }

  strapi.db.lifecycles.subscribe({
    models: ['plugin::users-permissions.user'],
    async beforeCreate(event) {
      event.params.data = event.params.data ?? {};

      if (isRoleValueMissing(event.params.data.role)) {
        event.params.data.role = authenticatedRoleId;
      }

      await applyResidentDefaults(event.params.data, authenticatedRoleId);
    },
    async beforeUpdate(event) {
      event.params.data = event.params.data ?? {};

      await applyResidentDefaults(event.params.data, authenticatedRoleId);
    },
  });

  strapi.log.info('Rol por defecto authenticated habilitado para nuevas creaciones de usuario.');
};

const enableAuthenticatedPermissions = async (strapi: StrapiApp): Promise<void> => {
  const roleService = strapi.plugin('users-permissions').service('role') as {
    findOne: (roleId: number) => Promise<Record<string, any>>;
    updateRole: (roleId: number, data: Record<string, unknown>) => Promise<void>;
  };

  const authenticatedRoleId = await findAuthenticatedRoleId(strapi);

  if (!authenticatedRoleId) {
    strapi.log.warn('No se encontro el rol authenticated; se omite la configuracion de permisos.');
    return;
  }

  const role = await roleService.findOne(authenticatedRoleId);
  const permissions = role.permissions ?? {};

  for (const action of AUTHENTICATED_ACTIONS) {
    const [typeName, controllerName, actionName] = action.split('.');

    if (!typeName || !controllerName || !actionName) {
      continue;
    }

    permissions[typeName] = permissions[typeName] ?? { controllers: {} };
    permissions[typeName].controllers = permissions[typeName].controllers ?? {};
    permissions[typeName].controllers[controllerName] =
      permissions[typeName].controllers[controllerName] ?? {};
    permissions[typeName].controllers[controllerName][actionName] = {
      enabled: true,
      policy: '',
    };
  }

  await roleService.updateRole(authenticatedRoleId, {
    description: role.description,
    name: role.name,
    permissions,
  });

  strapi.log.info('Permisos de rutas personalizadas habilitados para el rol authenticated.');
};

const enableAdministrativePermissions = async (strapi: StrapiApp): Promise<void> => {
  const roleService = strapi.plugin('users-permissions').service('role') as {
    findOne: (roleId: number) => Promise<Record<string, any>>;
    updateRole: (roleId: number, data: Record<string, unknown>) => Promise<void>;
  };

  const roles = await strapi.entityService.findMany('plugin::users-permissions.role', {
    fields: ['id'],
  });

  for (const roleEntry of roles) {
    const role = await roleService.findOne(roleEntry.id);
    const normalizedName = role.name?.toString().trim().toLowerCase();
    const normalizedType = role.type?.toString().trim().toLowerCase();
    const isAdministrativeRole =
      normalizedName === 'admin' ||
      normalizedName === 'administrador' ||
      (normalizedType && normalizedType !== 'authenticated' && normalizedType !== 'public');

    if (!isAdministrativeRole) {
      continue;
    }

    const permissions = role.permissions ?? {};

    for (const action of ADMIN_ACTIONS) {
      const [typeName, controllerName, actionName] = action.split('.');

      if (!typeName || !controllerName || !actionName) {
        continue;
      }

      permissions[typeName] = permissions[typeName] ?? { controllers: {} };
      permissions[typeName].controllers = permissions[typeName].controllers ?? {};
      permissions[typeName].controllers[controllerName] =
        permissions[typeName].controllers[controllerName] ?? {};
      permissions[typeName].controllers[controllerName][actionName] = {
        enabled: true,
        policy: '',
      };
    }

    await roleService.updateRole(roleEntry.id, {
      description: role.description,
      name: role.name,
      permissions,
    });
  }

  strapi.log.info('Permisos administrativos para rutas personalizadas habilitados.');
};

const attachOrphanProxyAuthorizations = async (strapi: StrapiApp): Promise<void> => {
  if (!strapi.entityService.update) {
    return;
  }

  const currentAssemblies = await strapi.entityService.findMany('api::assembly.assembly', {
    fields: ['id'],
    filters: {
      status: 'in_progress',
    },
    sort: {
      date: 'asc',
    },
    limit: 1,
  });

  const scheduledAssemblies = currentAssemblies.length
    ? currentAssemblies
    : await strapi.entityService.findMany('api::assembly.assembly', {
        fields: ['id'],
        filters: {
          status: 'scheduled',
        },
        sort: {
          date: 'asc',
        },
        limit: 1,
      });

  const targetAssembly = scheduledAssemblies[0] as AssemblyRow | undefined;

  if (!targetAssembly?.id) {
    strapi.log.warn('No hay asamblea vigente para asociar poderes historicos.');
    return;
  }

  const proxyQuery = strapi.db.query('api::proxy-authorization.proxy-authorization');
  const orphanDeclarations =
    (await proxyQuery.findMany?.({
      where: {
        assembly: {
          id: {
            $null: true,
          },
        },
      },
    })) ?? [];

  let updated = 0;

  for (const declaration of orphanDeclarations as ProxyAuthorizationRow[]) {
    await strapi.entityService.update('api::proxy-authorization.proxy-authorization', declaration.id, {
      data: {
        assembly: targetAssembly.id,
      },
    });
    updated += 1;
  }

  if (updated > 0) {
    strapi.log.info(`Poderes historicos asociados a la asamblea ${targetAssembly.id}: ${updated}.`);
  }
};

export default {
  register({ strapi }: { strapi: StrapiApp }) {
    strapi.server?.routes([
      {
        method: 'GET',
        path: '/',
        handler: (ctx) => {
          ctx.set('Content-Type', 'application/json; charset=utf-8');
          ctx.body = {
            ok: true,
            service: 'vr-api',
            message: 'API online',
          };
        },
        config: {
          auth: false,
        },
      },
      {
        method: 'GET',
        path: '/health',
        handler: (ctx) => {
          ctx.set('Content-Type', 'application/json; charset=utf-8');
          ctx.body = {
            ok: true,
            service: 'vr-api',
            status: 'healthy',
          };
        },
        config: {
          auth: false,
        },
      },
    ]);
  },

  async bootstrap({ strapi }: { strapi: StrapiApp }) {
    const fs = require('fs');
    const xlsPath = residentRoster.resolveRosterPath(process.cwd());

    try {
      await enableAuthenticatedPermissions(strapi);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      strapi.log.error(`Fallo la configuracion de permisos authenticated: ${message}`);
    }

    try {
      await enableAdministrativePermissions(strapi);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      strapi.log.error(`Fallo la configuracion de permisos administrativos: ${message}`);
    }

    try {
      await registerDefaultUserRoleHook(strapi);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      strapi.log.error(`Fallo el registro del rol por defecto para usuarios: ${message}`);
    }

    try {
      await ensureResidentCoefficientPrecision(strapi);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      strapi.log.error(`Fallo el ajuste de precision para coeficiente: ${message}`);
    }

    try {
      await ensureVoteWeightPrecision(strapi);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      strapi.log.error(`Fallo el ajuste de precision para weight: ${message}`);
    }

    try {
      await attachOrphanProxyAuthorizations(strapi);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      strapi.log.error(`Fallo la asociacion de poderes historicos: ${message}`);
    }

    runDeferredStartupTask(strapi, 'sincronizacion del padron', async () => {
      if (!fs.existsSync(xlsPath)) {
        strapi.log.warn('No se encontro el padron Excel de la asamblea.');
        return;
      }

      const owners = readAssemblyOwners(xlsPath);
      await syncAssemblyOwners(strapi, owners);
    });

    runDeferredStartupTask(strapi, 'reparacion automatica de pesos de voto', async () => {
      await repairPersistedVoteWeights(strapi);
    });
  },
};
