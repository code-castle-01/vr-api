type StrapiApp = {
  db: {
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
};

type AssemblyOwnerRow = {
  fullName: string;
  unit: string;
};

const DEFAULT_COEFFICIENT = 100;
const DEFAULT_EMAIL_DOMAIN = 'vegasdelrio.com';
const FIRST_DATA_ROW = 3;

const buildUserEmail = (unit: string): string => `${unit.toLowerCase()}@${DEFAULT_EMAIL_DOMAIN}`;

const buildDefaultPassword = (unit: string): string => `VR-${unit.toUpperCase()}`;

const AUTHENTICATED_ACTIONS = [
  'api::account.account.me',
  'api::proxy-authorization.proxy-authorization.mine',
  'api::proxy-authorization.proxy-authorization.availableResidents',
  'api::proxy-authorization.proxy-authorization.submit',
  'api::vote.vote.ballot',
  'api::vote.vote.cast',
];

const ADMIN_ACTIONS = [
  'api::proxy-authorization.proxy-authorization.adminByAssembly',
];

type AssemblyRow = {
  id: number;
};

type ProxyAuthorizationRow = {
  id: number;
};

const readAssemblyOwners = (filePath: string): AssemblyOwnerRow[] => {
  const xlsx = require('xlsx');

  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  return rows
    .slice(FIRST_DATA_ROW)
    .map((row) => {
      const unit = row?.[0]?.toString().trim().toUpperCase();
      const fullName = row?.[1]?.toString().trim();

      if (!unit || !fullName) {
        return null;
      }

      return {
        unit,
        fullName,
      };
    })
    .filter((row): row is AssemblyOwnerRow => row !== null);
};

const syncAssemblyOwners = async (strapi: StrapiApp, owners: AssemblyOwnerRow[]): Promise<void> => {
  const userService = strapi.plugin('users-permissions').service('user') as {
    add: (data: Record<string, unknown>) => Promise<unknown>;
    edit: (id: number, data: Record<string, unknown>) => Promise<unknown>;
  };
  const roles = await strapi.entityService.findMany('plugin::users-permissions.role', {
    filters: { type: 'authenticated' },
    fields: ['id'],
  });
  const authenticatedRoleId = roles[0]?.id;

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
      Coeficiente: Number(existingUser?.Coeficiente ?? DEFAULT_COEFFICIENT),
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

    const shouldBackfillPassword = !existingUser.password;

    await userService.edit(existingUser.id as number, {
      ...baseData,
      ...(shouldBackfillPassword ? { password: buildDefaultPassword(owner.unit) } : {}),
    });
    updated += 1;
  }

  strapi.log.info(
    `Sincronizacion de copropietarios completada. Creados: ${created}. Actualizados: ${updated}.`
  );
};

const enableAuthenticatedPermissions = async (strapi: StrapiApp): Promise<void> => {
  const roleService = strapi.plugin('users-permissions').service('role') as {
    findOne: (roleId: number) => Promise<Record<string, any>>;
    updateRole: (roleId: number, data: Record<string, unknown>) => Promise<void>;
  };

  const roles = await strapi.entityService.findMany('plugin::users-permissions.role', {
    filters: { type: 'authenticated' },
    fields: ['id'],
  });
  const authenticatedRoleId = roles[0]?.id;

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
  register() {},

  async bootstrap({ strapi }: { strapi: StrapiApp }) {
    const fs = require('fs');
    const path = require('path');

    const xlsPath = path.join(__dirname, '../../doc', 'LISTA ASISTENCIA REUNION ASAMBLEA 2026.xls');

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
      await attachOrphanProxyAuthorizations(strapi);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      strapi.log.error(`Fallo la asociacion de poderes historicos: ${message}`);
    }

    if (!fs.existsSync(xlsPath)) {
      strapi.log.warn('No se encontro el padron Excel de la asamblea.');
      return;
    }

    try {
      const owners = readAssemblyOwners(xlsPath);
      await syncAssemblyOwners(strapi, owners);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      strapi.log.error(`Fallo la sincronizacion del padron de copropietarios: ${message}`);
    }
  },
};
