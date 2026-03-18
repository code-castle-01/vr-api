import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  type ResidentAccessMode,
  type ResidentAssemblyEntity,
  type ResidentProxyAuthorizationEntity,
  type ResidentSupportDocumentEntity,
  type ResidentUserEntity,
  findCurrentAssembly,
  getResidentAssemblyParticipationState,
  getAssemblyQuorumSummary,
  getResidentRepresentationState,
  isAdminRole,
  lockResidentRepresentation,
  normalizeResidentName,
  parseNumericValue,
  readRosterUnitSet,
  serializeAssemblySummary,
  serializeSupportDocument,
} from '../../../utils/resident-session';

const { ApplicationError, ForbiddenError, NotFoundError, ValidationError } = errors;

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
  ) => Promise<Array<ResidentSupportDocumentEntity>>;
};

type SubmitDeclarationInput = {
  representedUserId: number;
};

const MAX_OWNER_PROXY_COUNT = 2;
const MAX_PROXY_TOTAL_COUNT = 2;
const ALLOWED_FILE_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const sortByUnit = (left: ResidentUserEntity, right: ResidentUserEntity) => {
  return (left.UnidadPrivada ?? '').localeCompare(right.UnidadPrivada ?? '');
};

export default factories.createCoreService(
  'api::proxy-authorization.proxy-authorization',
  ({ strapi }) => {
    const findAssemblyById = async (
      assemblyId: number
    ): Promise<ResidentAssemblyEntity | null> => {
      return (await strapi.entityService.findOne('api::assembly.assembly', assemblyId, {
        fields: ['id', 'title', 'date', 'status'],
      })) as ResidentAssemblyEntity | null;
    };

    const ensureAdminUser = async (userId: number) => {
      const user = (await strapi.entityService.findOne(
        'plugin::users-permissions.user',
        userId,
        {
          fields: ['id'],
          populate: {
            role: {
              fields: ['id', 'name', 'type'],
            },
          },
        }
      )) as ResidentUserEntity | null;

      if (!user) {
        throw new NotFoundError('No se encontro el usuario autenticado.');
      }

      if (!isAdminRole(user.role)) {
        throw new ForbiddenError('Solo un administrador puede consultar los poderes de la asamblea.');
      }

      return user;
    };

    const findCurrentResident = async (userId: number) => {
      const user = (await strapi.entityService.findOne(
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
      )) as ResidentUserEntity | null;

      if (!user) {
        throw new NotFoundError('No se encontro el usuario autenticado.');
      }

      return user;
    };

    return {
      async getSummary(userId: number, accessMode: ResidentAccessMode) {
        const [currentAssembly, currentUser] = await Promise.all([
          findCurrentAssembly(strapi),
          findCurrentResident(userId),
        ]);
        const representationState =
          currentAssembly?.id
            ? await getResidentRepresentationState(strapi, {
                accessMode,
                assemblyId: currentAssembly.id,
                user: currentUser,
              })
            : {
                canProceedToSurveys: accessMode === 'owner',
                delegatedBy: null,
                externalResidents: [],
                maxAdditionalDeclarations: accessMode === 'owner' ? 2 : 1,
                principal: {
                  coefficient: parseNumericValue(currentUser.Coeficiente ?? 0),
                  email: currentUser.email ?? null,
                  id: currentUser.id,
                  name: normalizeResidentName(currentUser),
                  unit: currentUser.UnidadPrivada ?? null,
                },
                proxySelfDeclaration: null,
                totalDeclarationsCount: 0,
                totalHomesRepresented: accessMode === 'owner' ? 1 : 0,
                totalWeightRepresented:
                  accessMode === 'owner'
                    ? parseNumericValue(currentUser.Coeficiente ?? 0)
                    : 0,
              };
        const participationState = currentAssembly?.id
          ? await getResidentAssemblyParticipationState(strapi, {
              assemblyId: currentAssembly.id,
              userId,
            })
          : {
              hasCastVotes: false,
              representationLocked: false,
            };

        return {
          accessMode,
          assembly: serializeAssemblySummary(currentAssembly),
          canManageDeclarations: Boolean(
            currentAssembly &&
              currentAssembly.status !== 'finished' &&
              !participationState.representationLocked &&
              !participationState.hasCastVotes
          ),
          canProceedToSurveys: representationState.canProceedToSurveys,
          delegatedBy: representationState.delegatedBy,
          hasDeclarations: representationState.totalDeclarationsCount > 0,
          hasCastVotes: participationState.hasCastVotes,
          maxAdditionalDeclarations: representationState.maxAdditionalDeclarations,
          principal: representationState.principal,
          proxySelfAuthorization: {
            declaration: representationState.proxySelfDeclaration,
            required: accessMode === 'proxy',
            uploaded: Boolean(representationState.proxySelfDeclaration),
          },
          representationLocked: participationState.representationLocked,
          representedResidents: representationState.externalResidents,
          totalDeclarationsCount: representationState.totalDeclarationsCount,
          totalHomesRepresented: representationState.totalHomesRepresented,
          totalWeightRepresented: representationState.totalWeightRepresented,
        };
      },

      async listAvailableResidents(userId: number, _accessMode: ResidentAccessMode) {
        const currentAssembly = await findCurrentAssembly(strapi);

        if (!currentAssembly) {
          return [];
        }

        const rosterUnitSet = readRosterUnitSet();

        const occupiedRepresentations = (await strapi.db
          .query('api::proxy-authorization.proxy-authorization')
          .findMany({
            populate: {
              represented_user: {
                populate: {
                  role: true,
                },
              },
            },
            where: {
              assembly: currentAssembly.id,
              represented_user: {
                id: {
                  $notNull: true,
                },
              },
            },
          })) as ResidentProxyAuthorizationEntity[];

        const alreadyRepresentedIds = new Set(
          occupiedRepresentations
            .map((item) => item.represented_user?.id)
            .filter((value): value is number => typeof value === 'number')
        );
        const participantAttendances = (await strapi.db
          .query('api::attendance.attendance')
          .findMany({
            where: {
              assembly: currentAssembly.id,
            },
          })) as Array<{ user?: number | { id?: number | null } | null }>;
        const directParticipantIds = new Set(
          participantAttendances
            .map((attendance) =>
              typeof attendance.user === 'number'
                ? attendance.user
                : attendance.user?.id ?? null
            )
            .filter((value): value is number => typeof value === 'number')
        );
        const votes = (await strapi.db.query('api::vote.vote').findMany({
          where: {
            agenda_item: {
              assembly: currentAssembly.id,
            },
          },
          populate: {
            user: true,
          },
        })) as Array<{ user?: number | { id?: number | null } | null }>;
        const voterIds = new Set(
          votes
            .map((vote) =>
              typeof vote.user === 'number' ? vote.user : vote.user?.id ?? null
            )
            .filter((value): value is number => typeof value === 'number')
        );

        const residents = (await strapi.entityService.findMany('plugin::users-permissions.user', {
          fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'Coeficiente', 'blocked', 'email'],
          populate: {
            role: {
              fields: ['id', 'name', 'type'],
            },
          },
        })) as ResidentUserEntity[];

        return residents
          .filter((resident) => resident.id !== userId)
          .filter((resident) => !resident.blocked)
          .filter((resident) => !isAdminRole(resident.role))
          .filter((resident) => rosterUnitSet.has(resident.UnidadPrivada ?? ''))
          .filter((resident) => !alreadyRepresentedIds.has(resident.id))
          .filter((resident) => !directParticipantIds.has(resident.id))
          .filter((resident) => !voterIds.has(resident.id))
          .sort(sortByUnit)
          .map((resident) => ({
            coefficient: parseNumericValue(resident.Coeficiente ?? 0),
            id: resident.id,
            name: normalizeResidentName(resident),
            unit: resident.UnidadPrivada ?? null,
          }));
      },

      async submitDeclarations(
        userId: number,
        accessMode: ResidentAccessMode,
        payload: unknown,
        files: unknown
      ) {
        const [currentAssembly, currentUser] = await Promise.all([
          findCurrentAssembly(strapi),
          findCurrentResident(userId),
        ]);

        if (!currentAssembly) {
          throw new ApplicationError(
            'No hay una asamblea programada o en curso para registrar poderes en este momento.'
          );
        }

        if (currentAssembly.status === 'finished') {
          throw new ForbiddenError(
            'No puedes registrar poderes cuando la asamblea ya fue finalizada.'
          );
        }

        const participationState = await getResidentAssemblyParticipationState(strapi, {
          assemblyId: currentAssembly.id,
          userId,
        });

        if (participationState.representationLocked) {
          throw new ForbiddenError(
            'Ya confirmaste que participarás sin poderes adicionales y no puedes registrar nuevos poderes.'
          );
        }

        if (participationState.hasCastVotes) {
          throw new ForbiddenError(
            'Ya emitiste tu voto en la asamblea y no puedes modificar la representación.'
          );
        }

        const existingDeclarations = (await strapi.db
          .query('api::proxy-authorization.proxy-authorization')
          .findMany({
            where: {
              assembly: currentAssembly.id,
              submitted_by: userId,
            },
          })) as ResidentProxyAuthorizationEntity[];

        if (existingDeclarations.length > 0) {
          throw new ApplicationError('Ya registraste poderes para esta sesion de asamblea.');
        }

        const delegatedEntries = (await strapi.db
          .query('api::proxy-authorization.proxy-authorization')
          .findMany({
            populate: {
              submitted_by: true,
            },
            where: {
              assembly: currentAssembly.id,
              represented_user: userId,
            },
          })) as ResidentProxyAuthorizationEntity[];

        const representedByOtherResident = delegatedEntries.find(
          (entry) => entry.submitted_by?.id !== userId
        );

        if (representedByOtherResident) {
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

        if (
          (accessMode === 'owner' && parsedPayload.length > MAX_OWNER_PROXY_COUNT) ||
          (accessMode === 'proxy' && parsedPayload.length > MAX_PROXY_TOTAL_COUNT)
        ) {
          throw new ValidationError('Solo puedes registrar el maximo permitido de poderes.');
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
          throw new ValidationError('No puedes seleccionar la misma unidad mas de una vez.');
        }

        if (representedIds.some((residentId) => !Number.isInteger(residentId) || residentId <= 0)) {
          throw new ValidationError('Debes enviar residentes validos para registrar el poder.');
        }

        if (accessMode === 'owner' && representedIds.includes(userId)) {
          throw new ValidationError('Como propietario no debes cargar un poder sobre tu propia unidad.');
        }

        if (accessMode === 'proxy' && !representedIds.includes(userId)) {
          throw new ValidationError(
            'Como apoderado debes adjuntar primero el poder de la unidad con la que iniciaste sesion.'
          );
        }

        if (accessMode === 'proxy') {
          const externalIds = representedIds.filter((residentId) => residentId !== userId);

          if (externalIds.length > 1) {
            throw new ValidationError('Como apoderado solo puedes representar una unidad adicional.');
          }
        }

        const representedUsers = (await strapi.entityService.findMany('plugin::users-permissions.user', {
          fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'Coeficiente', 'blocked', 'email'],
          filters: {
            id: {
              $in: representedIds,
            },
          },
          populate: {
            role: {
              fields: ['id', 'name', 'type'],
            },
          },
        })) as ResidentUserEntity[];

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
            populate: {
              represented_user: true,
            },
            where: {
              assembly: currentAssembly.id,
              represented_user: {
                id: {
                  $in: representedIds,
                },
              },
            },
          })) as ResidentProxyAuthorizationEntity[];

        const occupiedByAnotherResident = occupiedRepresentations.find(
          (entry) => entry.submitted_by?.id !== currentUser.id
        );

        if (occupiedByAnotherResident) {
          throw new ValidationError(
            'Uno de los residentes seleccionados ya fue asignado como representado por otra persona.'
          );
        }

        const uploadService = strapi.plugin('upload').service('upload') as unknown as UploadService;

        await Promise.all(
          parsedPayload.map(async (item, index) => {
            const file = normalizedFiles[index];
            const resident = representedUsers.find(
              (entry) => entry.id === Number(item.representedUserId)
            );

            if (!resident || !file) {
              throw new ValidationError('No fue posible emparejar el archivo del poder con el residente.');
            }

            const uploadedFiles = await uploadService.upload({
              data: {
                fileInfo: {
                  alternativeText: `Poder ${resident.UnidadPrivada ?? resident.id}`,
                  caption: `Poder de ${normalizeResidentName(resident)}`,
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

        return await this.getSummary(userId, accessMode);
      },

      async lockRepresentation(userId: number, accessMode: ResidentAccessMode) {
        const [currentAssembly, currentUser] = await Promise.all([
          findCurrentAssembly(strapi),
          findCurrentResident(userId),
        ]);

        if (!currentAssembly) {
          throw new ApplicationError(
            'No hay una asamblea programada o en curso para confirmar tu participación.'
          );
        }

        if (currentAssembly.status === 'finished') {
          throw new ForbiddenError(
            'La asamblea ya fue finalizada y no admite cambios en la representación.'
          );
        }

        const representationState = await getResidentRepresentationState(strapi, {
          accessMode,
          assemblyId: currentAssembly.id,
          user: currentUser,
        });

        if (representationState.delegatedBy) {
          throw new ForbiddenError(
            'Tu unidad ya fue registrada como representada por otra persona.'
          );
        }

        if (representationState.totalDeclarationsCount > 0) {
          throw new ValidationError(
            'Primero debes remover los poderes activos si deseas continuar sin poderes.'
          );
        }

        await lockResidentRepresentation(strapi, {
          accessMode,
          assemblyId: currentAssembly.id,
          userId,
        });

        return await this.getSummary(userId, accessMode);
      },

      async removeDeclaration(userId: number, accessMode: ResidentAccessMode, declarationId: number) {
        const declaration = (await strapi.db
          .query('api::proxy-authorization.proxy-authorization')
          .findOne({
            populate: {
              assembly: true,
              submitted_by: true,
            },
            where: {
              id: declarationId,
            },
          })) as ResidentProxyAuthorizationEntity | null;

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

        if (assembly.status === 'finished') {
          throw new ForbiddenError(
            'No puedes remover poderes cuando la asamblea ya fue finalizada.'
          );
        }

        const participationState = await getResidentAssemblyParticipationState(strapi, {
          assemblyId: assembly.id,
          userId,
        });

        if (participationState.hasCastVotes) {
          throw new ForbiddenError(
            'Ya emitiste tu voto en la asamblea y no puedes modificar la representación.'
          );
        }

        await strapi.db.query('api::proxy-authorization.proxy-authorization').delete({
          where: {
            id: declarationId,
          },
        });

        return await this.getSummary(userId, accessMode);
      },

      async listByAssembly(userId: number, assemblyId: number) {
        await ensureAdminUser(userId);

        const [assembly, declarations] = await Promise.all([
          findAssemblyById(assemblyId),
          strapi.db.query('api::proxy-authorization.proxy-authorization').findMany({
            orderBy: {
              id: 'asc',
            },
            populate: {
              assembly: true,
              represented_user: true,
              submitted_by: true,
              support_document: true,
            },
            where: {
              assembly: assemblyId,
            },
          }) as Promise<ResidentProxyAuthorizationEntity[]>,
        ]);

        if (!assembly) {
          throw new NotFoundError('No se encontro la asamblea solicitada.');
        }

        const representativeIds = new Set(
          declarations
            .map((item) => item.submitted_by?.id)
            .filter((value): value is number => typeof value === 'number')
        );
        const quorumSummary = await getAssemblyQuorumSummary(strapi, assemblyId);

        return {
          assembly: serializeAssemblySummary(assembly),
          items: declarations.map((item) => ({
            document: serializeSupportDocument(item.support_document),
            id: item.id,
            registeredAt: item.createdAt ?? null,
            representedResident: item.represented_user
              ? {
                  coefficient: parseNumericValue(item.represented_user.Coeficiente ?? 0),
                  id: item.represented_user.id,
                  name: normalizeResidentName(item.represented_user),
                  unit: item.represented_user.UnidadPrivada ?? null,
                }
              : null,
            status: item.status ?? 'submitted',
            submittedBy: item.submitted_by
              ? {
                  coefficient: parseNumericValue(item.submitted_by.Coeficiente ?? 0),
                  id: item.submitted_by.id,
                  name: normalizeResidentName(item.submitted_by),
                  unit: item.submitted_by.UnidadPrivada ?? null,
                }
              : null,
          })),
          summary: {
            enabledHomesCount: quorumSummary.enabledHomesCount,
            loggedUsersCount: quorumSummary.loggedUsersCount,
            quorumMinHomes: quorumSummary.quorumMinHomes,
            quorumReached: quorumSummary.quorumReached,
            representedHomesCount: declarations.length,
            representativesCount: representativeIds.size,
            supportsCount: declarations.filter((item) => Boolean(item.support_document?.id)).length,
            totalHomesBase: quorumSummary.totalHomesBase,
          },
        };
      },
    };
  }
);
