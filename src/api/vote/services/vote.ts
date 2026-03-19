import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  type ResidentAccessMode,
  findCurrentAssembly as findCurrentAssemblyHelper,
  getResidentAccessModeForAssembly,
  getResidentAssemblyParticipationState,
  getResidentRepresentationState,
  lockResidentRepresentation,
  normalizeResidentName,
  normalizeResidentUnit,
  serializeSupportDocument,
} from '../../../utils/resident-session';

const { ApplicationError, ForbiddenError, NotFoundError, ValidationError } = errors;

type VoteMechanism = 'electronic' | 'in_person' | 'proxy' | 'correspondence';

type CastVoteInput = {
  accessMode: ResidentAccessMode;
  agendaItemId: number;
  mechanism: VoteMechanism;
  userId: number;
  voteOptionIds: number[];
};

type AssemblyEntity = {
  date?: string | null;
  id: number;
  status?: 'scheduled' | 'in_progress' | 'finished' | null;
  title?: string | null;
};

type AgendaItemEntity = {
  assembly?: {
    id: number;
    status?: 'scheduled' | 'in_progress' | 'finished' | null;
  } | null;
  id: number;
  requiresSpecialMajority?: boolean;
  status?: 'pending' | 'open' | 'closed';
  title?: string;
};

type VoteOptionEntity = {
  agenda_item?: { id: number } | null;
  id: number;
  text?: string;
};

type UserEntity = {
  Coeficiente?: number | string | null;
  EstadoCartera?: boolean | null;
  NombreCompleto?: string | null;
  UnidadPrivada?: string | null;
  blocked?: boolean | null;
  email?: string | null;
  id: number;
  role?: {
    id?: number;
    name?: string | null;
    type?: string | null;
  } | null;
  username?: string | null;
};

type ProxyAuthorizationEntity = {
  assembly?: AssemblyEntity | null;
  createdAt?: string | null;
  id: number;
  represented_user?: UserEntity | null;
  revoked_at?: string | null;
  revoked_by?: UserEntity | null;
  revoked_reason?: string | null;
  status?: 'submitted' | 'revoked' | null;
  support_document?: {
    id: number;
    mime?: string | null;
    name?: string | null;
    size?: number | null;
    url?: string | null;
  } | null;
  submitted_by?: UserEntity | null;
};

type AgendaItemListEntity = {
  assembly?: {
    date?: string | null;
    id: number;
    status?: 'scheduled' | 'in_progress' | 'finished' | null;
    title?: string | null;
  } | null;
  description?: string | null;
  id: number;
  requiresSpecialMajority?: boolean | null;
  status?: 'pending' | 'open' | 'closed';
  survey_locale?: string | null;
  survey_schema?: Record<string, unknown> | null;
  title?: string | null;
  vote_options?: Array<{
    id: number;
    text?: string | null;
  }>;
};

type ResultStatus =
  | 'closed'
  | 'closed_without_threshold'
  | 'leading'
  | 'leading_without_threshold'
  | 'no_votes'
  | 'tie';

type FlatVoteRow = {
  agenda_item?: { id: number } | number | null;
  createdAt?: string | null;
  id?: number;
  mechanism?: VoteMechanism | null;
  user?: { id: number } | number | null;
  vote_option?: { id: number; text?: string | null } | number | null;
  weight?: number | string | null;
};

type ResidentHistoryAttendanceRow = {
  access_mode?: string | null;
  assembly?: AssemblyEntity | null;
  checkInTime?: string | null;
  id: number;
  representation_locked?: boolean | null;
  user?: UserEntity | null;
};

type LegalAcceptanceEntity = {
  accepted_at?: string | null;
  context?: string | null;
  document_hash?: string | null;
  document_key?: string | null;
  document_version?: string | null;
  id: number;
  ip_address?: string | null;
  user_agent?: string | null;
};

type SurveyRecord = Record<string, unknown>;

const parseNumericValue = (value: number | string | null | undefined) => {
  const numericValue = Number(value ?? 0);

  return Number.isFinite(numericValue) ? numericValue : 0;
};

const OFFICIAL_VOTE_QUESTION = 'official_vote';
const VOTE_MECHANISM_LABELS: Record<VoteMechanism, string> = {
  correspondence: 'Correspondencia',
  electronic: 'Electronico',
  in_person: 'Presencial',
  proxy: 'Poder',
};

const isObjectRecord = (value: unknown): value is SurveyRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getVoteLockTimeoutSeconds = () => {
  const parsedValue = Number(process.env.VOTE_SUBMISSION_LOCK_TIMEOUT ?? 15);

  if (!Number.isFinite(parsedValue)) {
    return 15;
  }

  return Math.max(1, Math.min(60, Math.trunc(parsedValue)));
};

const toTrimmedString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const parseMysqlRawScalar = (value: unknown, key: string) => {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (Array.isArray(item)) {
        const nestedValue = parseMysqlRawScalar(item, key);

        if (nestedValue !== null) {
          return nestedValue;
        }

        continue;
      }

      if (isObjectRecord(item) && key in item) {
        return Number(item[key]);
      }
    }

    return null;
  }

  if (isObjectRecord(value) && key in value) {
    return Number(value[key]);
  }

  return null;
};

const getResidentAgendaStatus = (
  agendaStatus: 'pending' | 'open' | 'closed' | undefined,
  assemblyStatus: 'scheduled' | 'in_progress' | 'finished' | null | undefined
) => {
  if (agendaStatus === 'closed') {
    return 'closed' as const;
  }

  if (agendaStatus === 'open') {
    return 'open' as const;
  }

  if (assemblyStatus === 'in_progress') {
    return 'open' as const;
  }

  if (assemblyStatus === 'finished') {
    return 'closed' as const;
  }

  return 'pending' as const;
};

const findOfficialVoteContent = (
  value: unknown,
  context?: {
    pageDescription?: string | null;
    pageTitle?: string | null;
  }
):
  | {
      pageDescription?: string | null;
      pageTitle?: string | null;
      questionDescription?: string | null;
      questionTitle?: string | null;
    }
  | null => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findOfficialVoteContent(item, context);

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (!isObjectRecord(value)) {
    return null;
  }

  const nextContext =
    Array.isArray(value.elements) || Array.isArray(value.questions)
      ? {
          pageDescription: toTrimmedString(value.description) || context?.pageDescription,
          pageTitle: toTrimmedString(value.title) || context?.pageTitle,
        }
      : context;

  if (value.name === OFFICIAL_VOTE_QUESTION) {
    return {
      pageDescription: nextContext?.pageDescription ?? null,
      pageTitle: nextContext?.pageTitle ?? null,
      questionDescription: toTrimmedString(value.description) || null,
      questionTitle: toTrimmedString(value.title) || null,
    };
  }

  for (const nestedValue of Object.values(value)) {
    const found = findOfficialVoteContent(nestedValue, nextContext);

    if (found) {
      return found;
    }
  }

  return null;
};

const getOfficialVoteSummary = (
  surveySchema: Record<string, unknown> | null | undefined,
  fallbackTitle: string,
  fallbackDescription?: string | null
) => {
  const details = surveySchema ? findOfficialVoteContent(surveySchema) : null;

  return {
    questionDescription:
      details?.questionDescription ??
      details?.pageDescription ??
      fallbackDescription ??
      null,
    questionTitle: details?.questionTitle ?? fallbackTitle,
    sectionTitle: details?.pageTitle ?? null,
  };
};

const resolvePublicUrl = () => {
  const rawValue = process.env.PUBLIC_URL?.trim();

  if (!rawValue) {
    return '';
  }

  try {
    return new URL(rawValue).toString().replace(/\/$/, '');
  } catch {
    return '';
  }
};

const buildAbsoluteUrl = (url?: string | null) => {
  if (!url) {
    return null;
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const publicUrl = resolvePublicUrl();

  if (!publicUrl) {
    return url;
  }

  return `${publicUrl}${url.startsWith('/') ? '' : '/'}${url}`;
};

export default factories.createCoreService('api::vote.vote', ({ strapi }) => {
  const isMysqlClient = () => {
    const client = strapi.config.get<string>('database.connection.client', '');

    return client === 'mysql' || client === 'mysql2';
  };

  const withVoteSubmissionLock = async <T>(
    lockName: string,
    callback: () => Promise<T>
  ) => {
    if (!isMysqlClient()) {
      return callback();
    }

    const lockTimeoutSeconds = getVoteLockTimeoutSeconds();

    return strapi.db.connection.transaction(async (trx) => {
      const acquireResult = await trx.raw('SELECT GET_LOCK(?, ?) AS acquired', [
        lockName.slice(0, 64),
        lockTimeoutSeconds,
      ]);
      const wasLockAcquired = parseMysqlRawScalar(acquireResult, 'acquired');

      if (wasLockAcquired !== 1) {
        throw new ApplicationError(
          'Ya hay una solicitud de voto en proceso para este punto. Espera unos segundos e intentalo de nuevo.'
        );
      }

      try {
        return await callback();
      } finally {
        await trx.raw('SELECT RELEASE_LOCK(?) AS released', [lockName.slice(0, 64)]);
      }
    });
  };

  const findLatestFinishedAssemblyForResident = async (userId: number) => {
    const finishedAssemblies = (await strapi.entityService.findMany('api::assembly.assembly', {
      fields: ['id', 'title', 'date', 'status'],
      filters: {
        status: 'finished',
      },
      sort: {
        date: 'desc',
      },
      limit: 20,
    })) as AssemblyEntity[];

    if (!finishedAssemblies.length) {
      return null;
    }

    const finishedAssemblyIds = finishedAssemblies.map((assembly) => assembly.id);
    const [attendanceRows, voteRows, declarationRows] = await Promise.all([
      strapi.db.query('api::attendance.attendance').findMany({
        where: {
          assembly: {
            id: {
              $in: finishedAssemblyIds,
            },
          },
          user: userId,
        },
        populate: {
          assembly: {
            fields: ['id'],
          },
        },
      }) as Promise<Array<{ assembly?: { id: number } | number | null }>>,
      strapi.db.query('api::vote.vote').findMany({
        where: {
          user: userId,
          agenda_item: {
            assembly: {
              id: {
                $in: finishedAssemblyIds,
              },
            },
          },
        },
        populate: {
          agenda_item: {
            populate: {
              assembly: {
                fields: ['id'],
              },
            },
          },
        },
      }) as Promise<Array<{ agenda_item?: { assembly?: { id: number } | null } | null }>>,
      strapi.db.query('api::proxy-authorization.proxy-authorization').findMany({
        where: {
          assembly: {
            id: {
              $in: finishedAssemblyIds,
            },
          },
          $or: [{ submitted_by: userId }, { represented_user: userId }],
        },
        populate: {
          assembly: {
            fields: ['id'],
          },
        },
      }) as Promise<Array<{ assembly?: { id: number } | number | null }>>,
    ]);

    const participatedAssemblyIds = new Set<number>();

    for (const attendance of attendanceRows) {
      const assemblyId =
        typeof attendance.assembly === 'number'
          ? attendance.assembly
          : attendance.assembly?.id;

      if (typeof assemblyId === 'number') {
        participatedAssemblyIds.add(assemblyId);
      }
    }

    for (const vote of voteRows) {
      const assemblyId = vote.agenda_item?.assembly?.id;

      if (typeof assemblyId === 'number') {
        participatedAssemblyIds.add(assemblyId);
      }
    }

    for (const declaration of declarationRows) {
      const assemblyId =
        typeof declaration.assembly === 'number'
          ? declaration.assembly
          : declaration.assembly?.id;

      if (typeof assemblyId === 'number') {
        participatedAssemblyIds.add(assemblyId);
      }
    }

    return (
      finishedAssemblies.find((assembly) => participatedAssemblyIds.has(assembly.id)) ?? null
    );
  };

  const findAssemblyForResidentBallot = async (userId: number) => {
    const currentAssembly = await findCurrentAssemblyHelper(strapi);

    if (currentAssembly) {
      return currentAssembly;
    }

    return findLatestFinishedAssemblyForResident(userId);
  };

  const buildSurveysForAssembly = (
    assembly: AssemblyEntity,
    agendaItems: AgendaItemListEntity[],
    voteTotalsByOptionId: Map<number, { totalVotes: number; totalWeight: number }>,
    participationByAgendaItem: Map<
      number,
      { totalVotes: number; totalWeight: number; voterIds: Set<number> }
    >
  ) => {
    return agendaItems.map((agendaItem) => {
      const voteSummary = getOfficialVoteSummary(
        agendaItem.survey_schema,
        agendaItem.title ?? `Encuesta ${agendaItem.id}`,
        agendaItem.description ?? null
      );
      const normalizedStatus = getResidentAgendaStatus(
        agendaItem.status,
        assembly.status ?? agendaItem.assembly?.status
      );
      const participation = participationByAgendaItem.get(agendaItem.id);
      const options = (agendaItem.vote_options ?? [])
        .map((option) => {
          const totals = voteTotalsByOptionId.get(option.id);

          return {
            id: option.id,
            text: option.text ?? `Opcion ${option.id}`,
            totalVotes: totals?.totalVotes ?? 0,
            totalWeight: totals?.totalWeight ?? 0,
          };
        })
        .sort((left, right) => {
          if (right.totalWeight !== left.totalWeight) {
            return right.totalWeight - left.totalWeight;
          }

          if (right.totalVotes !== left.totalVotes) {
            return right.totalVotes - left.totalVotes;
          }

          return left.text.localeCompare(right.text);
        });

      const totalVotes = participation?.totalVotes ?? 0;
      const totalWeight = participation?.totalWeight ?? 0;
      const leadingOption = options[0] ?? null;
      const secondOption = options[1] ?? null;
      const hasTie =
        Boolean(leadingOption) &&
        Boolean(secondOption) &&
        leadingOption.totalWeight === secondOption.totalWeight &&
        leadingOption.totalVotes === secondOption.totalVotes;
      const winningShareByWeight =
        leadingOption && totalWeight > 0
          ? (leadingOption.totalWeight / totalWeight) * 100
          : 0;
      const meetsRequiredThreshold =
        !agendaItem.requiresSpecialMajority || winningShareByWeight >= 70;

      let resultStatus: ResultStatus = 'no_votes';

      if (totalVotes > 0 && hasTie) {
        resultStatus = 'tie';
      } else if (totalVotes > 0 && normalizedStatus === 'closed') {
        resultStatus = meetsRequiredThreshold ? 'closed' : 'closed_without_threshold';
      } else if (totalVotes > 0) {
        resultStatus = meetsRequiredThreshold ? 'leading' : 'leading_without_threshold';
      }

      const normalizedOptions = options.map((option) => {
        const shareByVotes = totalVotes > 0 ? (option.totalVotes / totalVotes) * 100 : 0;
        const shareByWeight = totalWeight > 0 ? (option.totalWeight / totalWeight) * 100 : 0;
        const isWinner =
          Boolean(leadingOption) &&
          !hasTie &&
          option.id === leadingOption.id &&
          option.totalVotes > 0;

        return {
          ...option,
          isWinner,
          shareByVotes,
          shareByWeight,
        };
      });

      const winningOption =
        normalizedOptions.find((option) => option.isWinner) ?? null;

      return {
        id: agendaItem.id,
        options: normalizedOptions,
        requiresSpecialMajority: Boolean(agendaItem.requiresSpecialMajority),
        resultStatus,
        questionDescription: voteSummary.questionDescription,
        questionTitle: voteSummary.questionTitle,
        sectionTitle: voteSummary.sectionTitle,
        status: normalizedStatus,
        summary: {
          totalOptions: normalizedOptions.length,
          totalVotes,
          totalWeight,
          winningOptionId: winningOption?.id ?? null,
        },
        surveyTitle: agendaItem.title ?? `Encuesta ${agendaItem.id}`,
        winningOption,
      };
    });
  };

  return {
    async getBallot(userId: number, accessMode: ResidentAccessMode) {
      const targetAssembly = await findAssemblyForResidentBallot(userId);
      const effectiveAccessMode =
        targetAssembly?.status === 'finished'
          ? await getResidentAccessModeForAssembly(strapi, {
              assemblyId: targetAssembly.id,
              userId,
            })
          : accessMode;
      const user = (await strapi.entityService.findOne('plugin::users-permissions.user', userId, {
        fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'Coeficiente', 'EstadoCartera'],
      })) as UserEntity | null;

      if (!user) {
        throw new NotFoundError('No se encontro el copropietario autenticado.');
      }

      const representationState =
        targetAssembly?.id
          ? await getResidentRepresentationState(strapi, {
              accessMode: effectiveAccessMode,
              assemblyId: targetAssembly.id,
              user,
            })
          : null;

      const agendaItems = targetAssembly
        ? ((await strapi.entityService.findMany('api::agenda-item.agenda-item', {
            fields: ['id', 'title', 'description', 'status', 'requiresSpecialMajority', 'survey_locale', 'survey_schema'],
            filters: {
              assembly: {
                id: targetAssembly.id,
              },
            },
            populate: {
              assembly: {
                fields: ['id', 'title', 'date', 'status'],
              },
              vote_options: {
                fields: ['id', 'text'],
              },
            },
            sort: {
              id: 'asc',
            },
          })) as AgendaItemListEntity[])
        : [];

      const votes = (await strapi.db.query('api::vote.vote').findMany({
        where: {
          user: userId,
          ...(targetAssembly?.id
            ? {
                agenda_item: {
                  assembly: targetAssembly.id,
                },
              }
            : {}),
        },
        populate: {
          agenda_item: true,
          vote_option: true,
        },
      })) as Array<{
        agenda_item?: number | { id: number } | null;
        id: number;
        vote_option?: {
          id: number;
        } | null;
        weight?: number | string | null;
      }>;

      const votesByAgendaItem = new Map<
        number,
        { ids: number[]; selectedOptionIds: number[]; weight: number }
      >();

      for (const vote of votes) {
        const agendaItemId =
          typeof vote.agenda_item === 'number'
            ? vote.agenda_item
            : vote.agenda_item?.id;

        if (!agendaItemId) {
          continue;
        }

        const existingVote = votesByAgendaItem.get(agendaItemId);
        const voteOptionId = vote.vote_option?.id ?? null;

        if (existingVote) {
          existingVote.ids.push(vote.id);

          if (typeof voteOptionId === 'number' && Number.isInteger(voteOptionId)) {
            existingVote.selectedOptionIds.push(voteOptionId);
          }

          if (!existingVote.weight) {
            existingVote.weight = Number(vote.weight ?? 0);
          }

          continue;
        }

        votesByAgendaItem.set(agendaItemId, {
          ids: [vote.id],
          selectedOptionIds:
            typeof voteOptionId === 'number' && Number.isInteger(voteOptionId)
              ? [voteOptionId]
              : [],
          weight: Number(vote.weight ?? 0),
        });
      }

      return {
        accessMode: effectiveAccessMode,
        assembly: targetAssembly
          ? {
              date: targetAssembly.date ?? null,
              id: targetAssembly.id,
              status: targetAssembly.status ?? null,
              title: targetAssembly.title ?? null,
            }
          : null,
        canCastVotes:
          representationState?.canProceedToSurveys ?? effectiveAccessMode === 'owner',
        delegatedBy: representationState?.delegatedBy ?? null,
        proxySelfAuthorized: Boolean(representationState?.proxySelfDeclaration),
        resident: {
          id: user.id,
          name: normalizeResidentName(user),
          unit: user.UnidadPrivada ?? null,
        },
        representedResidents:
          representationState?.externalResidents.map((resident) => ({
            id: resident.id,
            name: resident.name,
            unit: resident.unit,
          })) ?? [],
        surveys: agendaItems.map((agendaItem) => {
          const existingVote = votesByAgendaItem.get(agendaItem.id);

          return {
            assembly: agendaItem.assembly
              ? {
                  date: agendaItem.assembly.date ?? null,
                  id: agendaItem.assembly.id,
                  title: agendaItem.assembly.title ?? null,
                }
              : null,
            description: agendaItem.description ?? null,
            existingVote,
            id: agendaItem.id,
            options:
              agendaItem.vote_options?.map((option) => ({
                id: option.id,
                text: option.text ?? `Opcion ${option.id}`,
              })) ?? [],
            requiresSpecialMajority: Boolean(agendaItem.requiresSpecialMajority),
            surveyLocale: agendaItem.survey_locale ?? 'es',
            surveySchema: agendaItem.survey_schema ?? null,
            status: getResidentAgendaStatus(
              agendaItem.status,
              targetAssembly?.status ?? agendaItem.assembly?.status
            ),
            title: agendaItem.title ?? `Encuesta ${agendaItem.id}`,
          };
        }),
        totalHomesRepresented:
          representationState?.totalHomesRepresented ??
          (effectiveAccessMode === 'owner' ? 1 : 0),
        totalWeightRepresented:
          representationState?.totalWeightRepresented ??
          (effectiveAccessMode === 'owner' ? Number(user.Coeficiente ?? 0) : 0),
      };
    },

    async getResultsOverview() {
      const assemblies = (await strapi.entityService.findMany('api::assembly.assembly', {
        fields: ['id', 'title', 'date', 'status'],
        filters: {
          status: {
            $in: ['scheduled', 'in_progress', 'finished'],
          },
        },
        sort: {
          date: 'desc',
        },
      })) as AssemblyEntity[];

      if (!assemblies.length) {
        return {
          assemblies: [],
          generatedAt: new Date().toISOString(),
          summary: {
            closedSurveys: 0,
            distinctVoters: 0,
            openSurveys: 0,
            pendingSurveys: 0,
            totalAssemblies: 0,
            totalSurveys: 0,
            totalVotes: 0,
            totalWeight: 0,
          },
        };
      }

      const assemblyIds = assemblies.map((assembly) => assembly.id);
      const agendaItems = (await strapi.entityService.findMany('api::agenda-item.agenda-item', {
        fields: ['id', 'title', 'description', 'status', 'requiresSpecialMajority', 'survey_schema'],
        filters: {
          assembly: {
            id: {
              $in: assemblyIds,
            },
          },
        },
        populate: {
          assembly: {
            fields: ['id', 'title', 'date', 'status'],
          },
          vote_options: {
            fields: ['id', 'text'],
          },
        },
        sort: {
          id: 'asc',
        },
      })) as AgendaItemListEntity[];
      const agendaItemsByAssembly = new Map<number, AgendaItemListEntity[]>();

      for (const agendaItem of agendaItems) {
        const assemblyId = agendaItem.assembly?.id;

        if (!assemblyId) {
          continue;
        }

        const existingAgendaItems = agendaItemsByAssembly.get(assemblyId);

        if (existingAgendaItems) {
          existingAgendaItems.push(agendaItem);
          continue;
        }

        agendaItemsByAssembly.set(assemblyId, [agendaItem]);
      }

      const agendaItemIds = agendaItems.map((item) => item.id);

      const voteRows = agendaItemIds.length
        ? ((await strapi.db.query('api::vote.vote').findMany({
            where: {
              agenda_item: {
                id: {
                  $in: agendaItemIds,
                },
              },
            },
            populate: {
              agenda_item: true,
              user: true,
              vote_option: true,
            },
          })) as FlatVoteRow[])
        : [];

      const voteTotalsByOptionId = new Map<
        number,
        { totalVotes: number; totalWeight: number }
      >();
      const participationByAgendaItem = new Map<
        number,
        { totalVotes: number; totalWeight: number; voterIds: Set<number> }
      >();
      const distinctVoters = new Set<number>();
      let totalVotes = 0;
      let totalWeight = 0;

      for (const row of voteRows) {
        const agendaItemId =
          typeof row.agenda_item === 'number'
            ? row.agenda_item
            : row.agenda_item?.id;
        const voteOptionId =
          typeof row.vote_option === 'number'
            ? row.vote_option
            : row.vote_option?.id;
        const userId =
          typeof row.user === 'number'
            ? row.user
            : row.user?.id;
        const weight = parseNumericValue(row.weight);

        if (weight <= 0) {
          continue;
        }

        if (typeof userId === 'number' && Number.isInteger(userId) && userId > 0) {
          distinctVoters.add(userId);
        }

        if (
          typeof agendaItemId === 'number' &&
          Number.isInteger(agendaItemId) &&
          typeof userId === 'number' &&
          Number.isInteger(userId) &&
          userId > 0
        ) {
          const existingParticipation = participationByAgendaItem.get(agendaItemId);

          if (existingParticipation) {
            if (!existingParticipation.voterIds.has(userId)) {
              existingParticipation.voterIds.add(userId);
              existingParticipation.totalVotes += 1;
              existingParticipation.totalWeight += weight;
              totalVotes += 1;
              totalWeight += weight;
            }
          } else {
            participationByAgendaItem.set(agendaItemId, {
              totalVotes: 1,
              totalWeight: weight,
              voterIds: new Set([userId]),
            });
            totalVotes += 1;
            totalWeight += weight;
          }
        }

        if (typeof voteOptionId !== 'number' || !Number.isInteger(voteOptionId)) {
          continue;
        }

        const previousTotals = voteTotalsByOptionId.get(voteOptionId);

        voteTotalsByOptionId.set(voteOptionId, {
          totalVotes: (previousTotals?.totalVotes ?? 0) + 1,
          totalWeight: (previousTotals?.totalWeight ?? 0) + weight,
        });
      }

      const assembliesWithSurveys = assemblies
        .map((assembly) => {
          const assemblyAgendaItems = agendaItemsByAssembly.get(assembly.id) ?? [];
          const surveys = buildSurveysForAssembly(
            assembly,
            assemblyAgendaItems,
            voteTotalsByOptionId,
            participationByAgendaItem
          );
          const assemblyTotalVotes = surveys.reduce(
            (sum, survey) => sum + survey.summary.totalVotes,
            0
          );
          const assemblyTotalWeight = surveys.reduce(
            (sum, survey) => sum + survey.summary.totalWeight,
            0
          );

          return {
            date: assembly.date ?? null,
            id: assembly.id,
            status: assembly.status ?? 'scheduled',
            summary: {
              totalSurveys: surveys.length,
              totalVotes: assemblyTotalVotes,
              totalWeight: assemblyTotalWeight,
            },
            surveys,
            title: assembly.title ?? `Asamblea ${assembly.id}`,
          };
        })
        .filter((assembly) => assembly.surveys.length > 0);

      const allSurveys = assembliesWithSurveys.flatMap((assembly) => assembly.surveys);
      const openSurveys = allSurveys.filter((survey) => survey.status === 'open').length;
      const closedSurveys = allSurveys.filter((survey) => survey.status === 'closed').length;
      const pendingSurveys = allSurveys.filter((survey) => survey.status === 'pending').length;
      const totalSurveys = allSurveys.length;
      const totalVotesAcrossAssemblies = assembliesWithSurveys.reduce(
        (sum, assembly) => sum + assembly.summary.totalVotes,
        0
      );
      const totalWeightAcrossAssemblies = assembliesWithSurveys.reduce(
        (sum, assembly) => sum + assembly.summary.totalWeight,
        0
      );

      return {
        assemblies: assembliesWithSurveys,
        generatedAt: new Date().toISOString(),
        summary: {
          closedSurveys,
          distinctVoters: distinctVoters.size,
          openSurveys,
          pendingSurveys,
          totalAssemblies: assembliesWithSurveys.length,
          totalSurveys,
          totalVotes: totalVotesAcrossAssemblies,
          totalWeight: totalWeightAcrossAssemblies,
        },
      };
    },

    async getResidentHistory(userId: number) {
      const user = (await strapi.entityService.findOne('plugin::users-permissions.user', userId, {
        fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'Coeficiente', 'EstadoCartera', 'username'],
      })) as UserEntity | null;

      if (!user) {
        throw new NotFoundError('No se encontro el copropietario autenticado.');
      }

      const targetAssembly = await findLatestFinishedAssemblyForResident(userId);

      if (!targetAssembly) {
        return {
          assembly: null,
          declarations: [],
          legalAcceptance: null,
          participation: null,
          resident: {
            id: user.id,
            name: normalizeResidentName(user),
            unit: normalizeResidentUnit(user.UnidadPrivada ?? user.username ?? ''),
          },
          votes: [],
        };
      }

      const accessMode = await getResidentAccessModeForAssembly(strapi, {
        assemblyId: targetAssembly.id,
        userId,
      });
      const [participationState, representationState, attendance, voteRows, declarationRows, legalAcceptance] =
        await Promise.all([
        getResidentAssemblyParticipationState(strapi, {
          assemblyId: targetAssembly.id,
          userId,
        }),
        getResidentRepresentationState(strapi, {
          accessMode,
          assemblyId: targetAssembly.id,
          user,
        }),
        strapi.db.query('api::attendance.attendance').findOne({
          where: {
            assembly: targetAssembly.id,
            user: userId,
          },
        }) as Promise<ResidentHistoryAttendanceRow | null>,
        strapi.db.query('api::vote.vote').findMany({
          where: {
            user: userId,
            agenda_item: {
              assembly: targetAssembly.id,
            },
          },
          orderBy: {
            id: 'asc',
          },
          populate: {
            agenda_item: {
              fields: ['id', 'title', 'description', 'status', 'survey_schema'],
            },
            vote_option: {
              fields: ['id', 'text'],
            },
          },
        }) as Promise<
          Array<{
            agenda_item?: {
              description?: string | null;
              id: number;
              status?: 'pending' | 'open' | 'closed' | null;
              survey_schema?: Record<string, unknown> | null;
              title?: string | null;
            } | null;
            createdAt?: string | null;
            id: number;
            mechanism?: VoteMechanism | null;
            vote_option?: { id: number; text?: string | null } | null;
            weight?: number | string | null;
          }>
        >,
        strapi.db.query('api::proxy-authorization.proxy-authorization').findMany({
          where: {
            assembly: targetAssembly.id,
            submitted_by: userId,
          },
          orderBy: {
            id: 'asc',
          },
          populate: {
            represented_user: {
              fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'username'],
            },
            revoked_by: {
              fields: ['id', 'NombreCompleto', 'UnidadPrivada', 'username'],
            },
            support_document: true,
          },
        }) as Promise<ProxyAuthorizationEntity[]>,
        strapi.db.query('api::legal-acceptance.legal-acceptance').findOne({
          where: {
            context: 'resident_login',
            user: userId,
          },
          orderBy: [{ accepted_at: 'desc' }, { id: 'desc' }],
        }) as Promise<LegalAcceptanceEntity | null>,
        ]);

      const votesByAgendaId = new Map<
        number,
        {
          agendaId: number;
          agendaStatus: 'pending' | 'open' | 'closed';
          mechanism: VoteMechanism;
          optionLabels: Set<string>;
          questionDescription: string | null;
          questionTitle: string;
          recordedAt: string | null;
          sectionTitle: string | null;
          surveyTitle: string;
          voteIds: number[];
          weight: number;
        }
      >();

      for (const vote of voteRows) {
        if (!vote.agenda_item?.id) {
          continue;
        }

        const agendaId = vote.agenda_item.id;
        const existingVote = votesByAgendaId.get(agendaId);
        const voteSummary = getOfficialVoteSummary(
          vote.agenda_item.survey_schema,
          vote.agenda_item.title ?? `Encuesta ${agendaId}`,
          vote.agenda_item.description ?? null
        );
        const optionLabel =
          vote.vote_option?.text ?? (vote.vote_option?.id ? `Opcion ${vote.vote_option.id}` : '');
        const voteWeight = parseNumericValue(vote.weight);

        if (existingVote) {
          if (optionLabel) {
            existingVote.optionLabels.add(optionLabel);
          }

          if (!existingVote.recordedAt && vote.createdAt) {
            existingVote.recordedAt = vote.createdAt;
          }

          if (!existingVote.weight && voteWeight > 0) {
            existingVote.weight = voteWeight;
          }

          existingVote.voteIds.push(vote.id);
          continue;
        }

        votesByAgendaId.set(agendaId, {
          agendaId,
          agendaStatus: getResidentAgendaStatus(vote.agenda_item.status ?? undefined, targetAssembly.status),
          mechanism: vote.mechanism ?? 'electronic',
          optionLabels: new Set(optionLabel ? [optionLabel] : []),
          questionDescription: voteSummary.questionDescription,
          questionTitle: voteSummary.questionTitle,
          recordedAt: vote.createdAt ?? null,
          sectionTitle: voteSummary.sectionTitle,
          surveyTitle: vote.agenda_item.title ?? `Encuesta ${agendaId}`,
          voteIds: [vote.id],
          weight: voteWeight,
        });
      }

      const votes = Array.from(votesByAgendaId.values())
        .map((vote) => ({
          agendaItemId: vote.agendaId,
          agendaStatus: vote.agendaStatus,
          mechanism: VOTE_MECHANISM_LABELS[vote.mechanism] ?? vote.mechanism,
          questionDescription: vote.questionDescription,
          questionTitle: vote.questionTitle,
          recordedAt: vote.recordedAt,
          sectionTitle: vote.sectionTitle,
          selectedOptions: Array.from(vote.optionLabels),
          surveyTitle: vote.surveyTitle,
          voteIds: vote.voteIds,
          weight: vote.weight,
        }))
        .sort((left, right) => left.agendaItemId - right.agendaItemId);

      const declarations = declarationRows.map((declaration) => {
        const support = serializeSupportDocument(declaration.support_document);
        const supportUrl = buildAbsoluteUrl(support?.url ?? null);

        return {
          id: declaration.id,
          registeredAt: declaration.createdAt ?? null,
          representedResident: declaration.represented_user
            ? {
                id: declaration.represented_user.id,
                name: normalizeResidentName(declaration.represented_user),
                unit: normalizeResidentUnit(
                  declaration.represented_user.UnidadPrivada ??
                    declaration.represented_user.username ??
                    ''
                ),
              }
            : null,
          revokedAt: declaration.revoked_at ?? null,
          revokedBy: declaration.revoked_by
            ? {
                id: declaration.revoked_by.id,
                name: normalizeResidentName(declaration.revoked_by),
                unit: normalizeResidentUnit(
                  declaration.revoked_by.UnidadPrivada ?? declaration.revoked_by.username ?? ''
                ),
              }
            : null,
          revokedReason: declaration.revoked_reason?.trim() || null,
          status: declaration.status ?? 'submitted',
          support: support
            ? {
                ...support,
                url: supportUrl,
              }
            : null,
        };
      });

      return {
        assembly: {
          date: targetAssembly.date ?? null,
          id: targetAssembly.id,
          status: targetAssembly.status ?? 'finished',
          title: targetAssembly.title ?? `Asamblea ${targetAssembly.id}`,
        },
        declarations,
        legalAcceptance: legalAcceptance
          ? {
              acceptedAt: legalAcceptance.accepted_at ?? null,
              context: legalAcceptance.context ?? 'resident_login',
              documentHash: legalAcceptance.document_hash ?? null,
              documentKey: legalAcceptance.document_key ?? null,
              documentVersion: legalAcceptance.document_version ?? null,
              id: legalAcceptance.id,
              ipAddress: legalAcceptance.ip_address ?? null,
              userAgent: legalAcceptance.user_agent ?? null,
            }
          : null,
        participation: {
          accessMode,
          canCastVotes: representationState.canProceedToSurveys,
          checkInTime: attendance?.checkInTime ?? null,
          delegatedBy: representationState.delegatedBy,
          hasCastVotes: participationState.hasCastVotes,
          representationLocked: participationState.representationLocked,
          representedResidents: representationState.externalResidents,
          totalHomesRepresented: representationState.totalHomesRepresented,
          totalWeightRepresented: representationState.totalWeightRepresented,
        },
        resident: {
          id: user.id,
          name: normalizeResidentName(user),
          unit: normalizeResidentUnit(user.UnidadPrivada ?? user.username ?? ''),
        },
        votes,
      };
    },

    async castVote(input: CastVoteInput) {
      const voteOptionIds = [...new Set(input.voteOptionIds)].filter(
        (item) => Number.isInteger(item) && item > 0
      );

      if (!voteOptionIds.length) {
        throw new ValidationError('Debes seleccionar al menos una opcion de voto.');
      }

      const [user, agendaItem, voteOptions] = await Promise.all([
        strapi.db.query('plugin::users-permissions.user').findOne({
          where: { id: input.userId },
        }) as Promise<UserEntity | null>,
        strapi.entityService.findOne('api::agenda-item.agenda-item', input.agendaItemId, {
          fields: ['id', 'title', 'status', 'requiresSpecialMajority'],
          populate: {
            assembly: {
              fields: ['id', 'status'],
            },
          },
        }) as Promise<AgendaItemEntity | null>,
        strapi.entityService.findMany('api::vote-option.vote-option', {
          filters: {
            id: {
              $in: voteOptionIds,
            },
          },
          fields: ['id', 'text'],
          populate: {
            agenda_item: {
              fields: ['id'],
            },
          },
        }) as Promise<VoteOptionEntity[]>,
      ]);

      if (!user) {
        throw new NotFoundError('No se encontro el copropietario autenticado.');
      }

      if (user.EstadoCartera) {
        throw new ForbiddenError(
          'El usuario tiene restriccion de cartera y no puede votar hasta que el administrador lo habilite.'
        );
      }

      if (!agendaItem) {
        throw new NotFoundError('El punto del orden del dia no existe.');
      }

      if (!agendaItem.assembly?.id) {
        throw new ValidationError('El punto del orden del dia no tiene una asamblea asociada.');
      }

      const votingIsAvailable =
        agendaItem.status === 'open' ||
        getResidentAgendaStatus(agendaItem.status, agendaItem.assembly?.status) === 'open';

      if (!votingIsAvailable) {
        throw new ApplicationError('La votacion para este punto no esta abierta.');
      }

      if (voteOptions.length !== voteOptionIds.length) {
        throw new ValidationError('Una o mas opciones de voto no existen.');
      }

      if (
        voteOptions.some((voteOption) => voteOption.agenda_item?.id !== input.agendaItemId)
      ) {
        throw new ValidationError('La opcion de voto no pertenece al punto seleccionado.');
      }

      const voteOptionsById = new Map(voteOptions.map((voteOption) => [voteOption.id, voteOption]));
      const orderedVoteOptions = voteOptionIds
        .map((voteOptionId) => voteOptionsById.get(voteOptionId) ?? null)
        .filter((voteOption): voteOption is VoteOptionEntity => Boolean(voteOption));
      const submissionLockName = `vote:${agendaItem.id}:${input.userId}`;

      return withVoteSubmissionLock(submissionLockName, async () => {
        const [representationState, existingVote] = await Promise.all([
          getResidentRepresentationState(strapi, {
            accessMode: input.accessMode,
            assemblyId: agendaItem.assembly.id,
            user,
          }),
          strapi.db.query('api::vote.vote').findOne({
            where: {
              agenda_item: input.agendaItemId,
              user: input.userId,
            },
          }) as Promise<{ id: number } | null>,
        ]);

        if (representationState.delegatedBy) {
          throw new ForbiddenError(
            `Tu unidad ya fue representada mediante poder por ${
              representationState.delegatedBy.name
            }.`
          );
        }

        if (!representationState.canProceedToSurveys) {
          throw new ForbiddenError(
            'Debes adjuntar primero el poder de la unidad con la que ingresaste como apoderado.'
          );
        }

        if (existingVote) {
          throw new ApplicationError('El copropietario ya emitio su voto para este punto.');
        }

        const weight = representationState.totalWeightRepresented;

        if (!Number.isFinite(weight) || weight <= 0) {
          throw new ValidationError(
            'El coeficiente del copropietario no es valido para registrar el voto.'
          );
        }

        const mechanism =
          representationState.totalDeclarationsCount > 0 ? 'proxy' : input.mechanism;
        const votes = await Promise.all(
          orderedVoteOptions.map((voteOption) =>
            strapi.entityService.create('api::vote.vote', {
              data: {
                agenda_item: input.agendaItemId,
                mechanism,
                user: input.userId,
                vote_option: voteOption.id,
                weight,
              },
              populate: {
                vote_option: {
                  fields: ['id', 'text'],
                },
              },
            })
          )
        );

        await lockResidentRepresentation(strapi, {
          accessMode: input.accessMode,
          assemblyId: agendaItem.assembly.id,
          userId: input.userId,
        });

        return {
          agendaItem: {
            id: agendaItem.id,
            requiresSpecialMajority: Boolean(agendaItem.requiresSpecialMajority),
            status: agendaItem.status,
            title: agendaItem.title,
          },
          vote: {
            ids: votes.map((vote) => vote.id),
            mechanism,
            voteOptionIds,
            weight,
          },
          voter: {
            id: user.id,
            name: normalizeResidentName(user),
            unit: user.UnidadPrivada ?? null,
          },
          totalHomesRepresented: representationState.totalHomesRepresented,
        };
      });
    },
  };
});
