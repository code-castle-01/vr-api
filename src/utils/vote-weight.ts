import {
  getResidentAccessModeForAssembly,
  getResidentRepresentationState,
  isAdminRole,
  type ResidentUserEntity,
} from './resident-session';

type QueryService = {
  findMany: (params?: Record<string, unknown>) => Promise<unknown>;
  findOne: (params: Record<string, unknown>) => Promise<unknown>;
};

type EntityService = {
  create: (uid: string, params: Record<string, unknown>) => Promise<unknown>;
  findMany: (uid: string, params?: Record<string, unknown>) => Promise<unknown>;
  findOne: (uid: string, id: number, params?: Record<string, unknown>) => Promise<unknown>;
  update: (uid: string, id: number, params: Record<string, unknown>) => Promise<unknown>;
};

type StrapiLike = {
  db: {
    query: (uid: string) => QueryService;
  };
  entityService: EntityService;
  plugin: (name: string) => {
    service: (serviceName: string) => unknown;
  };
  log?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
  };
};

type VoteRow = {
  id: number;
  weight?: number | string | null;
  user?: { id: number } | number | null;
  agenda_item?:
    | {
        id: number;
        assembly?: { id: number } | number | null;
      }
    | number
    | null;
};

type RepairAssemblySummary = {
  assemblyId: number;
  updatedUsers: number;
  updatedVotes: number;
};

const WEIGHT_PRECISION = 6;
const WEIGHT_EPSILON = 1 / Math.pow(10, WEIGHT_PRECISION + 1);

const normalizeNumericValue = (value: number | string | null | undefined) => {
  const numericValue = Number(value ?? 0);

  return Number.isFinite(numericValue) ? numericValue : 0;
};

const formatVoteWeight = (value: number) =>
  Math.max(0, value).toFixed(WEIGHT_PRECISION);

const resolveVoteAssemblyId = (vote: VoteRow) => {
  const agendaItem = vote.agenda_item;

  if (!agendaItem || typeof agendaItem === 'number') {
    return null;
  }

  const assembly = agendaItem.assembly;

  if (typeof assembly === 'number') {
    return assembly;
  }

  return typeof assembly?.id === 'number' ? assembly.id : null;
};

const resolveVoteUserId = (vote: VoteRow) => {
  if (typeof vote.user === 'number') {
    return vote.user;
  }

  return typeof vote.user?.id === 'number' ? vote.user.id : null;
};

const findResidentUser = async (
  strapi: StrapiLike,
  userId: number
): Promise<ResidentUserEntity | null> =>
  ((await strapi.entityService.findOne('plugin::users-permissions.user', userId, {
    fields: [
      'id',
      'NombreCompleto',
      'UnidadPrivada',
      'Coeficiente',
      'EstadoCartera',
      'blocked',
      'email',
    ],
    populate: {
      role: {
        fields: ['id', 'name', 'type'],
      },
    },
  })) as ResidentUserEntity | null) ?? null;

export const syncResidentVoteWeights = async (
  strapi: StrapiLike,
  input: {
    assemblyId: number;
    userId: number;
  }
) => {
  const user = await findResidentUser(strapi, input.userId);

  if (!user || isAdminRole(user.role)) {
    return {
      updatedVotes: 0,
      userId: input.userId,
      weight: '0.000000',
    };
  }

  const accessMode = await getResidentAccessModeForAssembly(strapi, {
    assemblyId: input.assemblyId,
    userId: input.userId,
  });
  const representationState = await getResidentRepresentationState(strapi, {
    accessMode,
    assemblyId: input.assemblyId,
    user,
  });
  const votes = (await strapi.db.query('api::vote.vote').findMany({
    where: {
      agenda_item: {
        assembly: input.assemblyId,
      },
      user: input.userId,
    },
  })) as Array<{ id: number; weight?: number | string | null }>;

  if (!votes.length) {
    return {
      updatedVotes: 0,
      userId: input.userId,
      weight: formatVoteWeight(representationState.totalWeightRepresented),
    };
  }

  const nextWeight = formatVoteWeight(representationState.totalWeightRepresented);
  let updatedVotes = 0;

  for (const vote of votes) {
    const currentWeight = normalizeNumericValue(vote.weight);

    if (Math.abs(currentWeight - Number(nextWeight)) <= WEIGHT_EPSILON) {
      continue;
    }

    await strapi.entityService.update('api::vote.vote', vote.id, {
      data: {
        weight: nextWeight,
      },
    });
    updatedVotes += 1;
  }

  return {
    updatedVotes,
    userId: input.userId,
    weight: nextWeight,
  };
};

export const repairAssemblyVoteWeights = async (
  strapi: StrapiLike,
  assemblyId: number
): Promise<RepairAssemblySummary> => {
  const votes = (await strapi.db.query('api::vote.vote').findMany({
    populate: {
      user: {
        fields: ['id'],
      },
    },
    where: {
      agenda_item: {
        assembly: assemblyId,
      },
    },
  })) as VoteRow[];

  const userIds = [...new Set(votes.map(resolveVoteUserId).filter((value): value is number => value > 0))];
  let updatedUsers = 0;
  let updatedVotes = 0;

  for (const userId of userIds) {
    const result = await syncResidentVoteWeights(strapi, {
      assemblyId,
      userId,
    });

    if (result.updatedVotes > 0) {
      updatedUsers += 1;
      updatedVotes += result.updatedVotes;
    }
  }

  return {
    assemblyId,
    updatedUsers,
    updatedVotes,
  };
};

export const repairStoredVoteWeights = async (strapi: StrapiLike) => {
  const votes = (await strapi.db.query('api::vote.vote').findMany({
    populate: {
      agenda_item: {
        fields: ['id'],
        populate: {
          assembly: {
            fields: ['id'],
          },
        },
      },
      user: {
        fields: ['id'],
      },
    },
  })) as VoteRow[];

  const assemblyIds = [
    ...new Set(
      votes
        .map(resolveVoteAssemblyId)
        .filter((value): value is number => typeof value === 'number' && value > 0)
    ),
  ].sort((left, right) => left - right);

  const assemblies: RepairAssemblySummary[] = [];
  let updatedUsers = 0;
  let updatedVotes = 0;

  for (const assemblyId of assemblyIds) {
    const summary = await repairAssemblyVoteWeights(strapi, assemblyId);
    assemblies.push(summary);
    updatedUsers += summary.updatedUsers;
    updatedVotes += summary.updatedVotes;
  }

  return {
    assemblies,
    updatedUsers,
    updatedVotes,
  };
};
