import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';

const { ApplicationError, ForbiddenError, NotFoundError, ValidationError } = errors;

type RoleEntity = {
  id?: number;
  name?: string | null;
  type?: string | null;
};

type AssemblyEntity = {
  date?: string | null;
  id: number;
  status?: 'scheduled' | 'in_progress' | 'finished' | null;
  title?: string | null;
};

type UserEntity = {
  Coeficiente?: number | string | null;
  EstadoCartera?: boolean | null;
  NombreCompleto?: string | null;
  UnidadPrivada?: string | null;
  blocked?: boolean | null;
  email?: string | null;
  id: number;
  role?: RoleEntity | null;
  username?: string | null;
};

type SupportDocumentEntity = {
  id: number;
  mime?: string | null;
  name?: string | null;
  size?: number | null;
  url?: string | null;
};

type ProxyAuthorizationEntity = {
  assembly?: AssemblyEntity | null;
  createdAt?: string | null;
  id: number;
  represented_user?: UserEntity | null;
  status?: 'submitted' | null;
  submitted_by?: UserEntity | null;
  support_document?: SupportDocumentEntity | null;
};

type UploadFile = {
  mimetype?: string;
  name?: string;
  path?: string;
  size?: number;
  type?: string;
};

type UploadService = {
  upload: (
    input: {
      data?: Record<string, unknown>;
      files: UploadFile | UploadFile[];
    }
  ) => Promise<Array<SupportDocumentEntity>>;
};

type SubmitDeclarationInput = {
  representedUserId: number;
};

const MAX_PROXY_COUNT = 2;
const ALLOWED_FILE_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const normalizeName = (user?: UserEntity | null) =>
  user?.NombreCompleto ?? user?.UnidadPrivada ?? user?.email ?? `Usuario ${user?.id ?? ''}`;

const isAdminRole = (role?: RoleEntity | null) => {
  const normalizedName = role?.name?.trim().toLowerCase();
  const normalizedType = role?.type?.trim().toLowerCase();

  if (normalizedName === 'admin' || normalizedName === 'administrador') {
    return true;
  }

  return Boolean(normalizedType && normalizedType !== 'authenticated' && normalizedType !== 'public');
};

const sortByUnit = (left: UserEntity, right: UserEntity) => {
  return (left.UnidadPrivada ?? '').localeCompare(right.UnidadPrivada ?? '');
};

const serializeAssembly = (assembly?: AssemblyEntity | null) => {
  if (!assembly) {
    return null;
  }

  return {
    date: assembly.date ?? null,
    id: assembly.id,
    status: assembly.status ?? null,
    title: assembly.title ?? null,
  };
};

const serializeDocument = (document?: SupportDocumentEntity | null) => {
  if (!document) {
    return null;
  }

  return {
    id: document.id,
    mime: document.mime ?? null,
    name: document.name ?? null,
    size: Number(document.size ?? 0),
    url: document.url ?? null,
  };
};

export default factories.createCoreService(
  'api::proxy-authorization.proxy-authorization',
  ({ strapi }) => {
    const findCurrentAssembly = async (): Promise<AssemblyEntity | null> => {
      const inProgressAssemblies = (await strapi.entityService.findMany('api::assembly.assembly', {
        fields: ['id', 'title', 'date', 'status'],
        filters: {
          status: 'in_progress',
        },
        sort: {
          date: 'asc',
        },
        limit: 1,
      })) as AssemblyEntity[];

      if (inProgressAssemblies[0]) {
        return inProgressAssemblies[0];
      }

      const scheduledAssemblies = (await strapi.entityService.findMany('api::assembly.assembly', {
        fields: ['id', 'title', 'date', 'status'],
        filters: {
          status: 'scheduled',
        },
        sort: {
          date: 'asc',
        },
        limit: 1,
      })) as AssemblyEntity[];

      return scheduledAssemblies[0] ?? null;
    };

    const findAssemblyById = async (assemblyId: number): Promise<AssemblyEntity | null> => {
      return (await strapi.entityService.findOne('api::assembly.assembly', assemblyId, {
        fields: ['id', 'title', 'date', 'status'],
      })) as AssemblyEntity | null;
    };

    const ensureAdminUser = async (userId: number) => {
      const user = (await strapi.entityService.findOne('plugin::users-permissions.user', userId, {
        fields: ['id'],
        populate: {
          role: {
            fields: ['id', 'name', 'type'],
          },
        },
      })) as UserEntity | null;

      if (!user) {
        throw new NotFoundError('No se encontro el usuario autenticado.');
      }

      if (!isAdminRole(user.role)) {
        throw new ForbiddenError('Solo un administrador puede consultar los poderes de la asamblea.');
      }

      return user;
    };

    return {
      async getSummary(userId: number) {
        const currentAssembly = await findCurrentAssembly();
        const currentUser = (await strapi.entityService.findOne(
          'plugin::users-permissions.user',
          userId,
          {
            fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'Coeficiente', 'EstadoCartera', 'blocked', 'email'],
            populate: {
              role: {
                fields: ['id', 'name', 'type'],
              },
            },
          }
        )) as UserEntity | null;

        if (!currentUser) {
          throw new NotFoundError('No se encontro el usuario autenticado.');
        }

        const declarations = currentAssembly
          ? ((await strapi.db.query('api::proxy-authorization.proxy-authorization').findMany({
              where: {
                assembly: currentAssembly.id,
                submitted_by: userId,
              },
              populate: {
                represented_user: {
                  populate: {
                    role: true,
                  },
                },
                support_document: true,
              },
              orderBy: {
                id: 'asc',
              },
            })) as ProxyAuthorizationEntity[])
          : [];

        const representedBy = currentAssembly
          ? ((await strapi.db.query('api::proxy-authorization.proxy-authorization').findOne({
              where: {
                assembly: currentAssembly.id,
                represented_user: userId,
              },
              populate: {
                submitted_by: {
                  populate: {
                    role: true,
                  },
                },
              },
            })) as ProxyAuthorizationEntity | null)
          : null;

        const representedResidents = declarations
          .map((item) => ({
            declarationId: item.id,
            coefficient: Number(item.represented_user?.Coeficiente ?? 0),
            document: serializeDocument(item.support_document),
            id: item.represented_user?.id ?? item.id,
            name: normalizeName(item.represented_user),
            unit: item.represented_user?.UnidadPrivada ?? null,
          }))
          .sort((left, right) => (left.unit ?? '').localeCompare(right.unit ?? ''));

        const ownWeight = Number(currentUser.Coeficiente ?? 0);
        const representedWeight = representedResidents.reduce(
          (sum, item) => sum + Number(item.coefficient ?? 0),
          0
        );

        return {
          assembly: serializeAssembly(currentAssembly),
          canManageDeclarations: Boolean(
            currentAssembly && currentAssembly.status !== 'in_progress'
          ),
          delegatedBy: representedBy?.submitted_by
            ? {
                id: representedBy.submitted_by.id,
                name: normalizeName(representedBy.submitted_by),
                unit: representedBy.submitted_by.UnidadPrivada ?? null,
              }
            : null,
          hasDeclarations: representedResidents.length > 0,
          principal: {
            coefficient: ownWeight,
            email: currentUser.email ?? null,
            id: currentUser.id,
            name: normalizeName(currentUser),
            unit: currentUser.UnidadPrivada ?? null,
          },
          representedResidents,
          totalHomesRepresented: 1 + representedResidents.length,
          totalWeightRepresented: ownWeight + representedWeight,
        };
      },

      async listAvailableResidents(userId: number) {
        const currentAssembly = await findCurrentAssembly();

        if (!currentAssembly) {
          return [];
        }

        const occupiedRepresentations = (await strapi.db
          .query('api::proxy-authorization.proxy-authorization')
          .findMany({
            where: {
              assembly: currentAssembly.id,
              represented_user: {
                id: {
                  $notNull: true,
                },
              },
            },
            populate: {
              represented_user: {
                populate: {
                  role: true,
                },
              },
            },
          })) as ProxyAuthorizationEntity[];

        const alreadyRepresentedIds = new Set(
          occupiedRepresentations
            .map((item) => item.represented_user?.id)
            .filter((value): value is number => typeof value === 'number')
        );

        const residents = (await strapi.entityService.findMany('plugin::users-permissions.user', {
          fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'Coeficiente', 'blocked', 'email'],
          populate: {
            role: {
              fields: ['id', 'name', 'type'],
            },
          },
        })) as UserEntity[];

        return residents
          .filter((resident) => resident.id !== userId)
          .filter((resident) => !resident.blocked)
          .filter((resident) => !isAdminRole(resident.role))
          .filter((resident) => !alreadyRepresentedIds.has(resident.id))
          .sort(sortByUnit)
          .map((resident) => ({
            coefficient: Number(resident.Coeficiente ?? 0),
            id: resident.id,
            name: normalizeName(resident),
            unit: resident.UnidadPrivada ?? null,
          }));
      },

      async submitDeclarations(userId: number, payload: unknown, files: unknown) {
        const currentAssembly = await findCurrentAssembly();

        if (!currentAssembly) {
          throw new ApplicationError(
            'No hay una asamblea programada o en curso para registrar poderes en este momento.'
          );
        }

        const existingDeclarations = (await strapi.db
          .query('api::proxy-authorization.proxy-authorization')
          .findMany({
            where: {
              assembly: currentAssembly.id,
              submitted_by: userId,
            },
          })) as ProxyAuthorizationEntity[];

        if (existingDeclarations.length > 0) {
          throw new ApplicationError('Ya registraste poderes para esta sesion de asamblea.');
        }

        const representedBy = (await strapi.db.query('api::proxy-authorization.proxy-authorization').findOne({
          where: {
            assembly: currentAssembly.id,
            represented_user: userId,
          },
        })) as ProxyAuthorizationEntity | null;

        if (representedBy) {
          throw new ForbiddenError(
            'Tu unidad ya fue registrada como representada por otro residente y no puede declarar nuevos poderes.'
          );
        }

        let parsedPayload: SubmitDeclarationInput[];

        try {
          const rawValue = typeof payload === 'string' ? JSON.parse(payload) : payload;

          parsedPayload = Array.isArray(rawValue) ? (rawValue as SubmitDeclarationInput[]) : [];
        } catch {
          throw new ValidationError('No fue posible interpretar la informacion de los poderes.');
        }

        const normalizedFiles = Array.isArray(files)
          ? (files as UploadFile[])
          : files
            ? [files as UploadFile]
            : [];

        if (parsedPayload.length === 0) {
          throw new ValidationError('Debes seleccionar al menos un residente representado.');
        }

        if (parsedPayload.length > MAX_PROXY_COUNT) {
          throw new ValidationError('Solo puedes representar hasta dos residentes.');
        }

        if (parsedPayload.length !== normalizedFiles.length) {
          throw new ValidationError(
            'Cada residente seleccionado debe tener exactamente un soporte cargado.'
          );
        }

        for (const file of normalizedFiles) {
          const fileType = file.mimetype ?? file.type ?? '';

          if (!ALLOWED_FILE_TYPES.has(fileType)) {
            throw new ValidationError(
              'Solo se permiten archivos PDF o imagenes en formato JPG, PNG o WEBP.'
            );
          }
        }

        const representedIds = parsedPayload.map((item) => Number(item.representedUserId));
        const uniqueIds = new Set(representedIds);

        if (uniqueIds.size !== representedIds.length) {
          throw new ValidationError('No puedes seleccionar el mismo residente mas de una vez.');
        }

        if (representedIds.some((residentId) => !Number.isInteger(residentId))) {
          throw new ValidationError('Debes enviar residentes validos para registrar el poder.');
        }

        if (representedIds.includes(userId)) {
          throw new ValidationError('No puedes registrarte como representado por ti mismo.');
        }

        const representedUsers = (await strapi.entityService.findMany('plugin::users-permissions.user', {
          filters: {
            id: {
              $in: representedIds,
            },
          },
          fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'Coeficiente', 'blocked', 'email'],
          populate: {
            role: {
              fields: ['id', 'name', 'type'],
            },
          },
        })) as UserEntity[];

        if (representedUsers.length !== representedIds.length) {
          throw new NotFoundError('Uno o varios residentes seleccionados no existen.');
        }

        for (const resident of representedUsers) {
          if (resident.blocked) {
            throw new ValidationError(
              `La unidad ${resident.UnidadPrivada ?? resident.id} no tiene acceso habilitado para ser representada.`
            );
          }

          if (isAdminRole(resident.role)) {
            throw new ValidationError('No puedes registrar un usuario administrador como representado.');
          }
        }

        const occupiedRepresentations = (await strapi.db
          .query('api::proxy-authorization.proxy-authorization')
          .findMany({
            where: {
              assembly: currentAssembly.id,
              represented_user: {
                id: {
                  $in: representedIds,
                },
              },
            },
            populate: {
              represented_user: true,
            },
          })) as ProxyAuthorizationEntity[];

        if (occupiedRepresentations.length > 0) {
          throw new ValidationError(
            'Uno de los residentes seleccionados ya fue asignado como representado por otra persona.'
          );
        }

        const uploadService = strapi.plugin('upload').service('upload') as unknown as UploadService;

        await Promise.all(
          parsedPayload.map(async (item, index) => {
            const file = normalizedFiles[index];
            const resident = representedUsers.find((entry) => entry.id === Number(item.representedUserId));

            if (!resident || !file) {
              throw new ValidationError('No fue posible emparejar el archivo del poder con el residente.');
            }

            const uploadedFiles = await uploadService.upload({
              data: {
                fileInfo: {
                  alternativeText: `Poder ${resident.UnidadPrivada ?? resident.id}`,
                  caption: `Poder de ${normalizeName(resident)}`,
                  name: file.name ?? `poder-${resident.UnidadPrivada ?? resident.id}`,
                },
              },
              files: file,
            });

            const uploadedFile = uploadedFiles[0];

            await strapi.entityService.create('api::proxy-authorization.proxy-authorization', {
              data: {
                assembly: currentAssembly.id,
                represented_user: resident.id,
                status: 'submitted',
                submitted_by: userId,
                support_document: uploadedFile?.id,
              },
            });
          })
        );

        return await this.getSummary(userId);
      },

      async removeDeclaration(userId: number, declarationId: number) {
        const declaration = (await strapi.db
          .query('api::proxy-authorization.proxy-authorization')
          .findOne({
            where: {
              id: declarationId,
            },
            populate: {
              assembly: true,
              submitted_by: true,
            },
          })) as ProxyAuthorizationEntity | null;

        if (!declaration) {
          throw new NotFoundError('El poder indicado no existe o ya fue eliminado.');
        }

        if (declaration.submitted_by?.id !== userId) {
          throw new ForbiddenError('Solo quien registró el poder puede removerlo.');
        }

        const assembly = declaration.assembly?.id
          ? await findAssemblyById(declaration.assembly.id)
          : null;

        if (!assembly) {
          throw new NotFoundError('No se encontró la asamblea asociada al poder.');
        }

        if (assembly.status === 'in_progress') {
          throw new ForbiddenError(
            'No puedes remover poderes cuando la asamblea ya está en curso.'
          );
        }

        await strapi.db.query('api::proxy-authorization.proxy-authorization').delete({
          where: {
            id: declarationId,
          },
        });

        return await this.getSummary(userId);
      },

      async listByAssembly(userId: number, assemblyId: number) {
        await ensureAdminUser(userId);

        const assembly = await findAssemblyById(assemblyId);

        if (!assembly) {
          throw new NotFoundError('No se encontro la asamblea solicitada.');
        }

        const declarations = (await strapi.db.query('api::proxy-authorization.proxy-authorization').findMany({
          where: {
            assembly: assemblyId,
          },
          populate: {
            assembly: true,
            represented_user: true,
            submitted_by: true,
            support_document: true,
          },
          orderBy: {
            id: 'asc',
          },
        })) as ProxyAuthorizationEntity[];

        const representativeIds = new Set(
          declarations
            .map((item) => item.submitted_by?.id)
            .filter((value): value is number => typeof value === 'number')
        );

        return {
          assembly: serializeAssembly(assembly),
          items: declarations.map((item) => ({
            document: serializeDocument(item.support_document),
            id: item.id,
            registeredAt: item.createdAt ?? null,
            representedResident: item.represented_user
              ? {
                  coefficient: Number(item.represented_user.Coeficiente ?? 0),
                  id: item.represented_user.id,
                  name: normalizeName(item.represented_user),
                  unit: item.represented_user.UnidadPrivada ?? null,
                }
              : null,
            status: item.status ?? 'submitted',
            submittedBy: item.submitted_by
              ? {
                  coefficient: Number(item.submitted_by.Coeficiente ?? 0),
                  id: item.submitted_by.id,
                  name: normalizeName(item.submitted_by),
                  unit: item.submitted_by.UnidadPrivada ?? null,
                }
              : null,
          })),
          summary: {
            representedHomesCount: declarations.length,
            representativesCount: representativeIds.size,
            supportsCount: declarations.filter((item) => Boolean(item.support_document?.id)).length,
          },
        };
      },
    };
  }
);
