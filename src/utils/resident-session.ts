import type { Context } from 'koa';

const path = require('path');
const residentRoster = require(path.resolve(process.cwd(), 'shared', 'resident-roster'));

export type ResidentAccessMode = 'owner' | 'proxy';

export type ResidentRoleEntity = {
  id?: number;
  name?: string | null;
  type?: string | null;
};

export type ResidentAssemblyEntity = {
  date?: string | null;
  id: number;
  status?: 'scheduled' | 'in_progress' | 'finished' | null;
  title?: string | null;
};

export type ResidentUserEntity = {
  Coeficiente?: number | string | null;
  EstadoCartera?: boolean | null;
  NombreCompleto?: string | null;
  UnidadPrivada?: string | null;
  blocked?: boolean | null;
  email?: string | null;
  id: number;
  password?: string | null;
  role?: ResidentRoleEntity | null;
  username?: string | null;
};

export type ResidentSupportDocumentEntity = {
  id: number;
  mime?: string | null;
  name?: string | null;
  size?: number | null;
  url?: string | null;
};

export type ResidentProxyAuthorizationEntity = {
  assembly?: ResidentAssemblyEntity | null;
  createdAt?: string | null;
  id: number;
  represented_user?: ResidentUserEntity | null;
  status?: 'submitted' | null;
  submitted_by?: ResidentUserEntity | null;
  support_document?: ResidentSupportDocumentEntity | null;
};

type AttendanceEntity = {
  access_mode?: string | null;
  checkInTime?: string | null;
  id: number;
  representation_locked?: boolean | null;
  user?: ResidentUserEntity | null;
};

type EntityService = {
  create: (uid: string, params: Record<string, unknown>) => Promise<unknown>;
  findMany: (uid: string, params?: Record<string, unknown>) => Promise<unknown>;
  findOne: (uid: string, id: number, params?: Record<string, unknown>) => Promise<unknown>;
  update: (uid: string, id: number, params: Record<string, unknown>) => Promise<unknown>;
};

type QueryService = {
  findMany: (params?: Record<string, unknown>) => Promise<unknown>;
  findOne: (params: Record<string, unknown>) => Promise<unknown>;
};

type JwtService = {
  getToken: (ctx: Context) => Promise<Record<string, unknown> | null>;
  issue: (payload: Record<string, unknown>) => string;
};

type StrapiLike = {
  db?: {
    query: (uid: string) => QueryService;
  };
  entityService?: EntityService;
  plugin: (name: string) => {
    service: (serviceName: string) => unknown;
  };
};

export const DEFAULT_COEFFICIENT = Number(residentRoster.DEFAULT_COEFFICIENT);
export const QUORUM_MIN_HOMES = Number(residentRoster.QUORUM_MIN_HOMES);

export const normalizeResidentUnit = (value: unknown) =>
  residentRoster.normalizeUnit(typeof value === 'string' ? value : '');

export const buildResidentPassword = (unit: string) =>
  residentRoster.buildResidentPassword(unit);

export const buildLegacyResidentPassword = (unit: string) =>
  residentRoster.buildLegacyResidentPassword(unit);

export const buildResidentEmail = (unit: string) =>
  residentRoster.buildResidentEmail(unit);

export const parseNumericValue = (value: number | string | null | undefined) => {
  const parsedValue = Number(value ?? 0);

  return Number.isFinite(parsedValue) ? parsedValue : 0;
};

export const readRosterUnitSet = () => {
  const rosterPath = residentRoster.resolveRosterPath(process.cwd());
  const rosterOwners = residentRoster.readRosterOwners(rosterPath);

  return new Set(rosterOwners.map((owner: { unit: string }) => owner.unit));
};

export const normalizeResidentAccessMode = (
  value: unknown
): ResidentAccessMode | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === 'owner' || normalizedValue === 'propietario') {
    return 'owner';
  }

  if (normalizedValue === 'proxy' || normalizedValue === 'apoderado') {
    return 'proxy';
  }

  return null;
};

export const isAdminRole = (role?: ResidentRoleEntity | null) => {
  const normalizedName = role?.name?.trim().toLowerCase();
  const normalizedType = role?.type?.trim().toLowerCase();

  if (normalizedName === 'admin' || normalizedName === 'administrador') {
    return true;
  }

  return Boolean(
    normalizedType && normalizedType !== 'authenticated' && normalizedType !== 'public'
  );
};

export const normalizeResidentName = (user?: ResidentUserEntity | null) =>
  user?.NombreCompleto ??
  user?.UnidadPrivada ??
  user?.email ??
  user?.username ??
  `Usuario ${user?.id ?? ''}`;

export const serializeSupportDocument = (
  document?: ResidentSupportDocumentEntity | null
) => {
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

export const serializeAssemblySummary = (
  assembly?: ResidentAssemblyEntity | null
) => {
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

export const getJwtService = (strapi: StrapiLike) =>
  strapi.plugin('users-permissions').service('jwt') as JwtService;

const getEntityService = (strapi: StrapiLike) => {
  if (!strapi.entityService) {
    throw new Error('La capa de entityService de Strapi no está disponible.');
  }

  return strapi.entityService;
};

const getDatabase = (strapi: StrapiLike) => {
  if (!strapi.db) {
    throw new Error('La capa de base de datos de Strapi no está disponible.');
  }

  return strapi.db;
};

export const getResidentAccessModeFromContext = async (
  strapi: StrapiLike,
  ctx: Context
): Promise<ResidentAccessMode | null> => {
  const tokenPayload = await getJwtService(strapi).getToken(ctx);

  return normalizeResidentAccessMode(tokenPayload?.residentAccessMode);
};

export const findCurrentAssembly = async (
  strapi: StrapiLike
): Promise<ResidentAssemblyEntity | null> => {
  const entityService = getEntityService(strapi);
  const inProgressAssemblies = (await entityService.findMany(
    'api::assembly.assembly',
    {
      fields: ['id', 'title', 'date', 'status'],
      filters: {
        status: 'in_progress',
      },
      limit: 1,
      sort: {
        date: 'asc',
      },
    }
  )) as ResidentAssemblyEntity[];

  if (inProgressAssemblies[0]) {
    return inProgressAssemblies[0];
  }

  const scheduledAssemblies = (await entityService.findMany(
    'api::assembly.assembly',
    {
      fields: ['id', 'title', 'date', 'status'],
      filters: {
        status: 'scheduled',
      },
      limit: 1,
      sort: {
        date: 'asc',
      },
    }
  )) as ResidentAssemblyEntity[];

  return scheduledAssemblies[0] ?? null;
};

export const upsertResidentAttendance = async (
  strapi: StrapiLike,
  input: {
    accessMode: ResidentAccessMode;
    assemblyId: number;
    representationLocked?: boolean;
    userId: number;
  }
) => {
  const entityService = getEntityService(strapi);
  const attendanceDatabase = getDatabase(strapi);
  const attendanceQuery = attendanceDatabase.query('api::attendance.attendance');
  const existingAttendance = (await attendanceQuery.findOne({
    where: {
      assembly: input.assemblyId,
      user: input.userId,
    },
  })) as { id: number } | null;

  const data = {
    access_mode: input.accessMode,
    assembly: input.assemblyId,
    checkInTime: new Date().toISOString(),
    user: input.userId,
  } as Record<string, unknown>;

  if (typeof input.representationLocked === 'boolean') {
    data.representation_locked = input.representationLocked;
  }

  if (existingAttendance?.id) {
    await entityService.update('api::attendance.attendance', existingAttendance.id, {
      data,
    });
    return existingAttendance.id;
  }

  const createdAttendance = (await entityService.create(
    'api::attendance.attendance',
    {
      data,
    }
  )) as { id: number };

  return createdAttendance.id;
};

export const lockResidentRepresentation = async (
  strapi: StrapiLike,
  input: {
    accessMode: ResidentAccessMode;
    assemblyId: number;
    userId: number;
  }
) => {
  return upsertResidentAttendance(strapi, {
    ...input,
    representationLocked: true,
  });
};

export const getResidentAssemblyParticipationState = async (
  strapi: StrapiLike,
  input: {
    assemblyId: number;
    userId: number;
  }
) => {
  const database = getDatabase(strapi);
  const attendance = (await database.query('api::attendance.attendance').findOne({
    where: {
      assembly: input.assemblyId,
      user: input.userId,
    },
  })) as AttendanceEntity | null;
  const existingVote = (await database.query('api::vote.vote').findOne({
    where: {
      agenda_item: {
        assembly: input.assemblyId,
      },
      user: input.userId,
    },
  })) as { id: number } | null;

  return {
    hasCastVotes: Boolean(existingVote?.id),
    representationLocked: Boolean(attendance?.representation_locked),
  };
};

export const getResidentRepresentationState = async (
  strapi: StrapiLike,
  input: {
    accessMode: ResidentAccessMode;
    assemblyId: number;
    user: ResidentUserEntity;
  }
) => {
  const database = getDatabase(strapi);
  const declarations = (await database
    .query('api::proxy-authorization.proxy-authorization')
    .findMany({
      orderBy: {
        id: 'asc',
      },
      populate: {
        represented_user: {
          populate: {
            role: true,
          },
        },
        submitted_by: {
          populate: {
            role: true,
          },
        },
        support_document: true,
      },
      where: {
        assembly: input.assemblyId,
        submitted_by: input.user.id,
      },
    })) as ResidentProxyAuthorizationEntity[];

  const delegatedEntries = (await database
    .query('api::proxy-authorization.proxy-authorization')
    .findMany({
      populate: {
        submitted_by: {
          populate: {
            role: true,
          },
        },
      },
      where: {
        assembly: input.assemblyId,
        represented_user: input.user.id,
      },
    })) as ResidentProxyAuthorizationEntity[];

  const delegatedBy =
    delegatedEntries.find((entry) => entry.submitted_by?.id !== input.user.id)
      ?.submitted_by ?? null;

  const selfDeclaration =
    declarations.find(
      (entry) => entry.represented_user?.id === input.user.id
    ) ?? null;

  const externalDeclarations = declarations.filter(
    (entry) => entry.represented_user?.id && entry.represented_user.id !== input.user.id
  );

  const externalResidents = externalDeclarations
    .map((entry) => ({
      coefficient: parseNumericValue(entry.represented_user?.Coeficiente ?? 0),
      declarationId: entry.id,
      document: serializeSupportDocument(entry.support_document),
      id: entry.represented_user?.id ?? entry.id,
      name: normalizeResidentName(entry.represented_user),
      unit: entry.represented_user?.UnidadPrivada ?? null,
    }))
    .sort((left, right) => (left.unit ?? '').localeCompare(right.unit ?? ''));

  const ownWeight = parseNumericValue(input.user.Coeficiente ?? 0);
  const externalWeight = externalResidents.reduce(
    (sum, resident) => sum + resident.coefficient,
    0
  );
  const proxySelfEnabled = Boolean(selfDeclaration?.id);
  const canProceedToSurveys = input.accessMode === 'owner' || proxySelfEnabled;

  const totalHomesRepresented =
    input.accessMode === 'owner'
      ? 1 + externalResidents.length
      : proxySelfEnabled
        ? 1 + externalResidents.length
        : 0;

  const totalWeightRepresented =
    input.accessMode === 'owner'
      ? ownWeight + externalWeight
      : proxySelfEnabled
        ? ownWeight + externalWeight
        : 0;

  return {
    accessMode: input.accessMode,
    canProceedToSurveys,
    delegatedBy: delegatedBy
      ? {
          id: delegatedBy.id,
          name: normalizeResidentName(delegatedBy),
          unit: delegatedBy.UnidadPrivada ?? null,
        }
      : null,
    externalDeclarations,
    externalResidents,
    maxAdditionalDeclarations: input.accessMode === 'owner' ? 2 : 1,
    principal: {
      coefficient: ownWeight,
      email: input.user.email ?? null,
      id: input.user.id,
      name: normalizeResidentName(input.user),
      unit: input.user.UnidadPrivada ?? null,
    },
    proxySelfDeclaration: selfDeclaration
      ? {
          coefficient: ownWeight,
          declarationId: selfDeclaration.id,
          document: serializeSupportDocument(selfDeclaration.support_document),
          id: input.user.id,
          name: normalizeResidentName(input.user),
          unit: input.user.UnidadPrivada ?? null,
        }
      : null,
    totalDeclarationsCount:
      input.accessMode === 'owner'
        ? externalResidents.length
        : (proxySelfEnabled ? 1 : 0) + externalResidents.length,
    totalHomesRepresented,
    totalWeightRepresented,
  };
};

export const getRosterHomesBaseCount = async (strapi: StrapiLike) => {
  try {
    const rosterPath = residentRoster.resolveRosterPath(process.cwd());

    return residentRoster.readRosterOwners(rosterPath).length;
  } catch {
    const users = (await getEntityService(strapi).findMany(
      'plugin::users-permissions.user',
      {
        fields: ['id', 'UnidadPrivada'],
        populate: {
          role: {
            fields: ['id', 'name', 'type'],
          },
        },
      }
    )) as ResidentUserEntity[];

    return new Set(
      users
        .filter((user) => Boolean(user.UnidadPrivada))
        .filter((user) => !isAdminRole(user.role))
        .map((user) => normalizeResidentUnit(user.UnidadPrivada ?? ''))
    ).size;
  }
};

export const getAssemblyQuorumSummary = async (
  strapi: StrapiLike,
  assemblyId: number
) => {
  const attendanceDatabase = getDatabase(strapi);
  const attendances = (await attendanceDatabase.query('api::attendance.attendance').findMany({
    orderBy: {
      id: 'asc',
    },
    populate: {
      user: {
        fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'Coeficiente', 'email'],
        populate: {
          role: {
            fields: ['id', 'name', 'type'],
          },
        },
      },
    },
    where: {
      assembly: assemblyId,
    },
  })) as AttendanceEntity[];

  const attendanceByUserId = new Map<number, AttendanceEntity>();

  for (const attendance of attendances) {
    const userId = attendance.user?.id;

    if (!userId || isAdminRole(attendance.user?.role)) {
      continue;
    }

    attendanceByUserId.set(userId, attendance);
  }

  let enabledHomesCount = 0;

  for (const attendance of attendanceByUserId.values()) {
    const user = attendance.user;

    if (!user) {
      continue;
    }

    const accessMode =
      normalizeResidentAccessMode(attendance.access_mode) ?? 'owner';

    const representationState = await getResidentRepresentationState(strapi, {
      accessMode,
      assemblyId,
      user,
    });

    enabledHomesCount += representationState.totalHomesRepresented;
  }

  const totalHomesBase = await getRosterHomesBaseCount(strapi);

  return {
    enabledHomesCount,
    loggedUsersCount: attendanceByUserId.size,
    quorumMinHomes: QUORUM_MIN_HOMES,
    quorumReached: enabledHomesCount >= QUORUM_MIN_HOMES,
    totalHomesBase,
  };
};
